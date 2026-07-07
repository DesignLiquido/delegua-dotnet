import {
    Agrupamento,
    Atribuir,
    AvaliadorSintatico,
    Binario,
    Bloco,
    Declaracao,
    Enquanto,
    Escreva,
    Expressao,
    Lexador,
    Literal,
    Logico,
    Se,
    Unario,
    Var,
    Variavel,
} from '@designliquido/delegua';

import { ErroCompilador } from './erros/erro-compilador';
import { VisitanteBaseNaoImplementado } from './visitante-base-nao-implementado';

interface VariavelLocal {
    indice: number;
    tipoCil: string;
    tipoDelegua: string;
}

const MAPA_TIPOS_CIL: Record<string, string> = {
    inteiro: 'int32',
    numero: 'float64',
    logico: 'bool',
    texto: 'string',
};

/**
 * Compilador Delégua → CIL (.NET).
 * Suporta o núcleo da fatia inicial (`var`, leitura de variáveis, aritmética,
 * `escreva`) e a primeira etapa de controle de fluxo (`se`/`senao`,
 * `enquanto`, atribuição local, comparações, `e`/`ou`, `nao`).
 * Demais construtos continuam lançando `ErroCompilador`
 * (ver `VisitanteBaseNaoImplementado`).
 */
export class CompiladorDotnet extends VisitanteBaseNaoImplementado {
    lexador: Lexador;
    avaliadorSintatico: AvaliadorSintatico;

    private instrucoes: string[];
    private variaveis: Map<string, VariavelLocal>;
    private proximoIndiceLocal: number;
    private proximoRotulo: number;

    constructor() {
        super();
        this.lexador = new Lexador();
        this.avaliadorSintatico = new AvaliadorSintatico();
    }

    async compilar(codigo: string[]): Promise<string> {
        this.instrucoes = [];
        this.variaveis = new Map();
        this.proximoIndiceLocal = 0;
        this.proximoRotulo = 0;

        const retornoLexador = this.lexador.mapear(codigo, -1);
        const retornoAvaliadorSintatico = await this.avaliadorSintatico.analisar(retornoLexador, -1);
        const declaracoes = retornoAvaliadorSintatico.declaracoes as Declaracao[];

        for (const declaracao of declaracoes) {
            await declaracao.aceitar(this as any);
        }

        return this.montarModulo();
    }

    private montarModulo(): string {
        const locaisOrdenados = Array.from(this.variaveis.values()).sort((a, b) => a.indice - b.indice);
        const locais = locaisOrdenados.map((v) => `${v.tipoCil} V_${v.indice}`).join(', ');
        const linhaLocais = locais ? `    .locals init (${locais})\n` : '';
        const corpo = this.instrucoes.map((instrucao) => `    ${instrucao}`).join('\n');

        return (
            `.assembly extern mscorlib {}\n` +
            `.assembly Programa {}\n` +
            `.module programa.exe\n\n` +
            `.method public static void Main() cil managed\n` +
            `{\n` +
            `    .entrypoint\n` +
            `    .maxstack 8\n` +
            linhaLocais +
            (corpo ? corpo + '\n' : '') +
            `    ret\n` +
            `}\n`
        );
    }

    private normalizarTipo(tipo: string): string {
        if (tipo === 'número') return 'numero';
        if (tipo === 'lógico') return 'logico';
        return tipo;
    }

    private tipoEhNumerico(tipo: string): boolean {
        return tipo === 'inteiro' || tipo === 'numero';
    }

    private gerarRotulo(): string {
        const sufixo = this.proximoRotulo.toString().padStart(4, '0');
        this.proximoRotulo += 1;
        return `IL_${sufixo}`;
    }

    private emitirRotulo(rotulo: string): void {
        this.instrucoes.push(`${rotulo}:`);
    }

    private construtoDeixaValorNaPilha(construto: any): boolean {
        return !(construto instanceof Atribuir);
    }

    private async emitirSaltoCondicional(
        construto: any,
        rotulo: string,
        saltarQuandoVerdadeiro: boolean
    ): Promise<void> {
        const tipo = await construto.aceitar(this as any);

        if (tipo === 'logico') {
            this.instrucoes.push(`${saltarQuandoVerdadeiro ? 'brtrue' : 'brfalse'} ${rotulo}`);
            return;
        }

        if (this.construtoDeixaValorNaPilha(construto)) {
            this.instrucoes.push('pop');
        }

        if (saltarQuandoVerdadeiro) {
            this.instrucoes.push(`br ${rotulo}`);
        }
    }

    private async emitirOperacaoComparacao(expressao: Binario, tipoComparacao: string): Promise<void> {
        const tipoEsquerdo = this.resolverTipoConstruto(expressao.esquerda);
        const tipoDireito = this.resolverTipoConstruto(expressao.direita);

        if (this.tipoEhNumerico(tipoEsquerdo) && this.tipoEhNumerico(tipoDireito)) {
            const tipoPrevalente = tipoEsquerdo === 'numero' || tipoDireito === 'numero' ? 'numero' : 'inteiro';

            await expressao.esquerda.aceitar(this as any);
            if (tipoEsquerdo !== tipoPrevalente) this.instrucoes.push('conv.r8');

            await expressao.direita.aceitar(this as any);
            if (tipoDireito !== tipoPrevalente) this.instrucoes.push('conv.r8');

            switch (tipoComparacao) {
                case 'MAIOR':
                    this.instrucoes.push('cgt');
                    return;
                case 'MAIOR_IGUAL':
                    this.instrucoes.push('clt');
                    this.instrucoes.push('ldc.i4.0');
                    this.instrucoes.push('ceq');
                    return;
                case 'MENOR':
                    this.instrucoes.push('clt');
                    return;
                case 'MENOR_IGUAL':
                    this.instrucoes.push('cgt');
                    this.instrucoes.push('ldc.i4.0');
                    this.instrucoes.push('ceq');
                    return;
                case 'IGUAL_IGUAL':
                    this.instrucoes.push('ceq');
                    return;
                case 'DIFERENTE':
                    this.instrucoes.push('ceq');
                    this.instrucoes.push('ldc.i4.0');
                    this.instrucoes.push('ceq');
                    return;
            }
        }

        if ((tipoComparacao === 'IGUAL_IGUAL' || tipoComparacao === 'DIFERENTE') && tipoEsquerdo === 'texto' && tipoDireito === 'texto') {
            await expressao.esquerda.aceitar(this as any);
            await expressao.direita.aceitar(this as any);
            this.instrucoes.push('call bool [mscorlib]System.String::op_Equality(string, string)');
            if (tipoComparacao === 'DIFERENTE') {
                this.instrucoes.push('ldc.i4.0');
                this.instrucoes.push('ceq');
            }
            return;
        }

        if ((tipoComparacao === 'IGUAL_IGUAL' || tipoComparacao === 'DIFERENTE') && tipoEsquerdo === 'logico' && tipoDireito === 'logico') {
            await expressao.esquerda.aceitar(this as any);
            await expressao.direita.aceitar(this as any);
            this.instrucoes.push('ceq');
            if (tipoComparacao === 'DIFERENTE') {
                this.instrucoes.push('ldc.i4.0');
                this.instrucoes.push('ceq');
            }
            return;
        }

        throw new ErroCompilador(`Comparação '${expressao.operador.lexema}' não implementada para '${tipoEsquerdo}' e '${tipoDireito}'.`);
    }

    private mapearTipoCil(tipoDelegua: string): string {
        const tipoCil = MAPA_TIPOS_CIL[tipoDelegua];
        if (!tipoCil) {
            throw new ErroCompilador(`Tipo '${tipoDelegua}' não implementado para .NET.`);
        }
        return tipoCil;
    }

    private resolverTipoConstruto(construto: any): string {
        if (construto instanceof Literal) {
            // O parser marca todo literal numérico genericamente como 'número',
            // mesmo quando o valor é um inteiro (ex.: `123`). Por isso o valor
            // real decide inteiro-vs-numero aqui, e não `construto.tipo`.
            if (typeof construto.valor === 'boolean') return 'logico';
            if (typeof construto.valor === 'string') return 'texto';
            if (typeof construto.valor === 'number') return Number.isInteger(construto.valor) ? 'inteiro' : 'numero';
            throw new ErroCompilador('Não foi possível deduzir o tipo do literal.');
        }
        if (construto instanceof Variavel) {
            const local = this.variaveis.get(construto.simbolo.lexema);
            if (!local) throw new ErroCompilador(`Variável '${construto.simbolo.lexema}' não declarada.`);
            return local.tipoDelegua;
        }
        if (construto instanceof Atribuir) {
            if (!(construto.alvo instanceof Variavel)) {
                throw new ErroCompilador('Atribuição suportada apenas para variáveis locais.');
            }

            const local = this.variaveis.get(construto.alvo.simbolo.lexema);
            if (!local) throw new ErroCompilador(`Variável '${construto.alvo.simbolo.lexema}' não declarada.`);
            return local.tipoDelegua;
        }
        if (construto instanceof Binario) {
            if (['MAIOR', 'MAIOR_IGUAL', 'MENOR', 'MENOR_IGUAL', 'IGUAL_IGUAL', 'DIFERENTE'].includes(construto.operador.tipo)) {
                return 'logico';
            }
            if (construto.operador.tipo === 'DIVISAO') return 'numero';
            const tipoEsquerdo = this.resolverTipoConstruto(construto.esquerda);
            const tipoDireito = this.resolverTipoConstruto(construto.direita);
            return tipoEsquerdo === 'numero' || tipoDireito === 'numero' ? 'numero' : 'inteiro';
        }
        if (construto instanceof Logico) {
            return 'logico';
        }
        if (construto instanceof Unario) {
            if (construto.operador.tipo === 'NEGACAO' || construto.operador.tipo === 'NAO') {
                return 'logico';
            }
            return this.resolverTipoConstruto(construto.operando);
        }
        if (construto instanceof Agrupamento) {
            return this.resolverTipoConstruto((construto as any).expressao);
        }
        throw new ErroCompilador('Não foi possível resolver o tipo da expressão.');
    }

    private formatarDouble(valor: number): string {
        return Number.isInteger(valor) ? `${valor}.0` : `${valor}`;
    }

    private escaparTexto(valor: string): string {
        return valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    async visitarDeclaracaoVar(declaracao: Var): Promise<any> {
        // `declaracao.tipo` é preenchido pelo parser a partir do tipo do inicializador
        // quando não há anotação explícita — e sofre da mesma generalização de
        // 'número' descrita em `resolverTipoConstruto`. Só confia nele quando o
        // usuário anotou o tipo explicitamente (`var x: inteiro = 10`).
        const tipoDelegua = declaracao.tipoExplicito
            ? this.normalizarTipo(declaracao.tipo)
            : this.resolverTipoConstruto(declaracao.inicializador);

        await declaracao.inicializador.aceitar(this as any);

        const indice = this.proximoIndiceLocal++;
        const tipoCil = this.mapearTipoCil(tipoDelegua);
        this.variaveis.set(declaracao.simbolo.lexema, { indice, tipoCil, tipoDelegua });
        this.instrucoes.push(`stloc ${indice}`);
    }

    async visitarExpressaoLiteral(expressao: Literal): Promise<string> {
        const tipo = this.resolverTipoConstruto(expressao);
        switch (tipo) {
            case 'inteiro':
                this.instrucoes.push(`ldc.i4 ${expressao.valor}`);
                break;
            case 'numero':
                this.instrucoes.push(`ldc.r8 ${this.formatarDouble(expressao.valor as number)}`);
                break;
            case 'logico':
                this.instrucoes.push(expressao.valor ? 'ldc.i4.1' : 'ldc.i4.0');
                break;
            case 'texto':
                this.instrucoes.push(`ldstr "${this.escaparTexto(expressao.valor as string)}"`);
                break;
            default:
                throw new ErroCompilador(`Literal de tipo '${tipo}' não implementado.`);
        }
        return tipo;
    }

    async visitarExpressaoDeVariavel(expressao: Variavel): Promise<string> {
        const local = this.variaveis.get(expressao.simbolo.lexema);
        if (!local) throw new ErroCompilador(`Variável '${expressao.simbolo.lexema}' não declarada.`);
        this.instrucoes.push(`ldloc ${local.indice}`);
        return local.tipoDelegua;
    }

    async visitarExpressaoAgrupamento(expressao: Agrupamento): Promise<string> {
        return await (expressao as any).expressao.aceitar(this as any);
    }

    async visitarExpressaoBinaria(expressao: Binario): Promise<string> {
        if (['MAIOR', 'MAIOR_IGUAL', 'MENOR', 'MENOR_IGUAL', 'IGUAL_IGUAL', 'DIFERENTE'].includes(expressao.operador.tipo)) {
            await this.emitirOperacaoComparacao(expressao, expressao.operador.tipo);
            return 'logico';
        }

        const divisao = expressao.operador.tipo === 'DIVISAO';
        const tipoEsquerdo = this.resolverTipoConstruto(expressao.esquerda);
        const tipoDireito = this.resolverTipoConstruto(expressao.direita);
        const tipoPrevalente = divisao || tipoEsquerdo === 'numero' || tipoDireito === 'numero' ? 'numero' : 'inteiro';

        await expressao.esquerda.aceitar(this as any);
        if (tipoEsquerdo !== tipoPrevalente) this.instrucoes.push('conv.r8');

        await expressao.direita.aceitar(this as any);
        if (tipoDireito !== tipoPrevalente) this.instrucoes.push('conv.r8');

        switch (expressao.operador.tipo) {
            case 'ADICAO':
                this.instrucoes.push('add');
                break;
            case 'SUBTRACAO':
                this.instrucoes.push('sub');
                break;
            case 'MULTIPLICACAO':
                this.instrucoes.push('mul');
                break;
            case 'DIVISAO':
                this.instrucoes.push('div');
                break;
            default:
                throw new ErroCompilador(`Operador '${expressao.operador.lexema}' não implementado.`);
        }

        return tipoPrevalente;
    }

    async visitarExpressaoLogica(expressao: Logico): Promise<string> {
        const rotuloCurtoCircuito = this.gerarRotulo();
        const rotuloFim = this.gerarRotulo();

        switch (expressao.operador.tipo) {
            case 'E':
                await this.emitirSaltoCondicional(expressao.esquerda, rotuloCurtoCircuito, false);
                await this.emitirSaltoCondicional(expressao.direita, rotuloCurtoCircuito, false);
                this.instrucoes.push('ldc.i4.1');
                this.instrucoes.push(`br ${rotuloFim}`);
                this.emitirRotulo(rotuloCurtoCircuito);
                this.instrucoes.push('ldc.i4.0');
                this.emitirRotulo(rotuloFim);
                return 'logico';
            case 'OU':
                await this.emitirSaltoCondicional(expressao.esquerda, rotuloCurtoCircuito, true);
                await this.emitirSaltoCondicional(expressao.direita, rotuloCurtoCircuito, true);
                this.instrucoes.push('ldc.i4.0');
                this.instrucoes.push(`br ${rotuloFim}`);
                this.emitirRotulo(rotuloCurtoCircuito);
                this.instrucoes.push('ldc.i4.1');
                this.emitirRotulo(rotuloFim);
                return 'logico';
            default:
                throw new ErroCompilador(`Operador lógico '${expressao.operador.lexema}' não implementado.`);
        }
    }

    async visitarExpressaoUnaria(expressao: Unario): Promise<string> {
        const tipoOperando = this.resolverTipoConstruto(expressao.operando);

        switch (expressao.operador.tipo) {
            case 'ADICAO':
                if (!this.tipoEhNumerico(tipoOperando)) {
                    throw new ErroCompilador(`Operador '${expressao.operador.lexema}' requer operando numérico.`);
                }

                await expressao.operando.aceitar(this as any);
                return tipoOperando;
            case 'SUBTRACAO':
                if (!this.tipoEhNumerico(tipoOperando)) {
                    throw new ErroCompilador(`Operador '${expressao.operador.lexema}' requer operando numérico.`);
                }

                await expressao.operando.aceitar(this as any);
                this.instrucoes.push('neg');
                return tipoOperando;
            case 'NEGACAO':
            case 'NAO':
                await expressao.operando.aceitar(this as any);
                if (tipoOperando === 'logico') {
                    this.instrucoes.push('ldc.i4.0');
                    this.instrucoes.push('ceq');
                } else {
                    if (this.construtoDeixaValorNaPilha(expressao.operando)) {
                        this.instrucoes.push('pop');
                    }
                    this.instrucoes.push('ldc.i4.0');
                }

                return 'logico';
            default:
                throw new ErroCompilador(`Operador unário '${expressao.operador.lexema}' não implementado.`);
        }
    }

    async visitarExpressaoDeAtribuicao(expressao: Atribuir): Promise<string> {
        if (!(expressao.alvo instanceof Variavel)) {
            throw new ErroCompilador('Atribuição suportada apenas para variáveis locais.');
        }

        const local = this.variaveis.get(expressao.alvo.simbolo.lexema);
        if (!local) throw new ErroCompilador(`Variável '${expressao.alvo.simbolo.lexema}' não declarada.`);

        const tipoValor = this.resolverTipoConstruto(expressao.valor);
        const atribuicaoValida =
            tipoValor === local.tipoDelegua || (local.tipoDelegua === 'numero' && tipoValor === 'inteiro');

        if (!atribuicaoValida) {
            throw new ErroCompilador(
                `Não pode atribuir valor do tipo '${tipoValor}' à variável '${expressao.alvo.simbolo.lexema}' do tipo '${local.tipoDelegua}'.`
            );
        }

        await expressao.valor.aceitar(this as any);
        if (local.tipoDelegua === 'numero' && tipoValor === 'inteiro') {
            this.instrucoes.push('conv.r8');
        }

        this.instrucoes.push(`stloc ${local.indice}`);
        return local.tipoDelegua;
    }

    async visitarDeclaracaoDeExpressao(declaracao: Expressao): Promise<any> {
        await declaracao.expressao.aceitar(this as any);

        if (this.construtoDeixaValorNaPilha(declaracao.expressao)) {
            this.instrucoes.push('pop');
        }
    }

    async visitarExpressaoBloco(declaracao: Bloco): Promise<any> {
        for (const item of declaracao.declaracoes) {
            await item.aceitar(this as any);
        }
    }

    async visitarDeclaracaoSe(declaracao: Se): Promise<any> {
        const rotuloFim = this.gerarRotulo();
        const caminhosSeSenao = declaracao.caminhosSeSenao || [];
        let rotuloProximoCaminho = this.gerarRotulo();

        await this.emitirSaltoCondicional(declaracao.condicao, rotuloProximoCaminho, false);
        await declaracao.caminhoEntao.aceitar(this as any);
        this.instrucoes.push(`br ${rotuloFim}`);

        this.emitirRotulo(rotuloProximoCaminho);

        for (let indice = 0; indice < caminhosSeSenao.length; indice++) {
            const caminho = caminhosSeSenao[indice];
            const rotuloFalha = this.gerarRotulo();

            await this.emitirSaltoCondicional(caminho.condicao, rotuloFalha, false);
            await caminho.caminho.aceitar(this as any);
            this.instrucoes.push(`br ${rotuloFim}`);
            this.emitirRotulo(rotuloFalha);
        }

        if (declaracao.caminhoSenao) {
            await declaracao.caminhoSenao.aceitar(this as any);
        }

        this.emitirRotulo(rotuloFim);
    }

    async visitarDeclaracaoEnquanto(declaracao: Enquanto): Promise<any> {
        const rotuloInicio = this.gerarRotulo();
        const rotuloFim = this.gerarRotulo();

        this.emitirRotulo(rotuloInicio);
        await this.emitirSaltoCondicional(declaracao.condicao, rotuloFim, false);
        await declaracao.corpo.aceitar(this as any);
        this.instrucoes.push(`br ${rotuloInicio}`);
        this.emitirRotulo(rotuloFim);
    }

    async visitarDeclaracaoEscreva(declaracao: Escreva): Promise<any> {
        for (const argumento of declaracao.argumentos) {
            const tipo: string = await (argumento as any).aceitar(this as any);
            switch (tipo) {
                case 'inteiro':
                    this.instrucoes.push('call void [mscorlib]System.Console::WriteLine(int32)');
                    break;
                case 'numero':
                    this.instrucoes.push('call void [mscorlib]System.Console::WriteLine(float64)');
                    break;
                case 'logico':
                    this.instrucoes.push('call void [mscorlib]System.Console::WriteLine(bool)');
                    break;
                case 'texto':
                    this.instrucoes.push('call void [mscorlib]System.Console::WriteLine(string)');
                    break;
                default:
                    throw new ErroCompilador(`Não sabe como escrever valor de tipo '${tipo}'.`);
            }
        }
    }
}
