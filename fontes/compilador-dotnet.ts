import {
    AcessoIndiceVariavel,
    AtribuicaoPorIndice,
    Agrupamento,
    Atribuir,
    AvaliadorSintatico,
    Binario,
    Bloco,
    Chamada,
    Declaracao,
    Dicionario,
    Enquanto,
    Escolha,
    Escreva,
    Expressao,
    FuncaoDeclaracao,
    Lexador,
    Literal,
    Logico,
    Para,
    Retorna,
    Se,
    Unario,
    Var,
    Variavel,
    Vetor,
} from '@designliquido/delegua';

import { ErroCompilador } from './erros/erro-compilador';
import { VisitanteBaseNaoImplementado } from './visitante-base-nao-implementado';

interface VariavelLocal {
    indice: number;
    tipoCil: string;
    tipoDelegua: string;
    armazenamento: 'argumento' | 'local';
}

interface ParametroCompilado {
    nome: string;
    tipoDelegua: string;
    tipoCil: string;
}

interface FuncaoCompilada {
    nome: string;
    nomeCil: string;
    tipoRetornoDelegua: string;
    tipoRetornoCil: string;
    parametros: ParametroCompilado[];
}

interface EstadoCompilacao {
    instrucoes: string[];
    variaveis: Map<string, VariavelLocal>;
    locaisTemporarios: VariavelLocal[];
    proximoIndiceLocal: number;
    pilhaRotulosLoop: Array<{ continua: string; sustar: string }>;
    funcaoAtual: FuncaoCompilada | null;
}

const MAPA_TIPOS_CIL: Record<string, string> = {
    inteiro: 'int32',
    numero: 'float64',
    logico: 'bool',
    texto: 'string',
    vazio: 'void',
};

/**
 * Compilador Delégua → CIL (.NET).
 * Suporta o núcleo da fatia inicial (`var`, leitura de variáveis, aritmética,
 * `escreva`) e a etapa atual de controle de fluxo (`se`/`senao`,
 * `enquanto`, `para`, `escolha`, `continua`, `sustar`, atribuição local,
 * comparações, `e`/`ou`, `nao`), além do primeiro recorte de funções e vetores.
 * Demais construtos continuam lançando `ErroCompilador`
 * (ver `VisitanteBaseNaoImplementado`).
 */
export class CompiladorDotnet extends VisitanteBaseNaoImplementado {
    lexador: Lexador;
    avaliadorSintatico: AvaliadorSintatico;

    private instrucoes: string[];
    private variaveis: Map<string, VariavelLocal>;
    private locaisTemporarios: VariavelLocal[];
    private proximoIndiceLocal: number;
    private proximoRotulo: number;
    private pilhaRotulosLoop: Array<{ continua: string; sustar: string }>;
    private funcoes: Map<string, FuncaoCompilada>;
    private metodosCompilados: string[];
    private funcaoAtual: FuncaoCompilada | null;

    constructor() {
        super();
        this.lexador = new Lexador();
        this.avaliadorSintatico = new AvaliadorSintatico();
    }

    async compilar(codigo: string[]): Promise<string> {
        this.instrucoes = [];
        this.variaveis = new Map();
        this.locaisTemporarios = [];
        this.proximoIndiceLocal = 0;
        this.proximoRotulo = 0;
        this.pilhaRotulosLoop = [];
        this.funcoes = new Map();
        this.metodosCompilados = [];
        this.funcaoAtual = null;

        const retornoLexador = this.lexador.mapear(codigo, -1);
        const retornoAvaliadorSintatico = await this.avaliadorSintatico.analisar(retornoLexador, -1);
        const declaracoes = retornoAvaliadorSintatico.declaracoes as Declaracao[];

        for (const declaracao of declaracoes) {
            if (declaracao instanceof FuncaoDeclaracao) {
                this.registrarAssinaturaFuncao(declaracao);
            }
        }

        for (const declaracao of declaracoes) {
            await declaracao.aceitar(this as any);
        }

        return this.montarModulo();
    }

    private montarModulo(): string {
        const locaisOrdenados = [...Array.from(this.variaveis.values()), ...this.locaisTemporarios].sort(
            (a, b) => a.indice - b.indice
        );
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
            `}\n` +
            (this.metodosCompilados.length ? `\n${this.metodosCompilados.join('\n\n')}\n` : '')
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

    private tipoEhVetor(tipo: string): boolean {
        return tipo.endsWith('[]');
    }

    private tipoEhDicionario(tipo: string): boolean {
        return tipo.startsWith('dicionario<') && tipo.endsWith('>');
    }

    private normalizarTipoVetor(tipo: string): string {
        if (tipo === 'número[]') return 'numero[]';
        if (tipo === 'lógico[]') return 'logico[]';
        return tipo;
    }

    private obterTipoElementoVetor(tipo: string): string {
        if (!this.tipoEhVetor(tipo)) {
            throw new ErroCompilador(`Tipo '${tipo}' não é um vetor.`);
        }

        return this.normalizarTipo(tipo.slice(0, -2));
    }

    private criarTipoDicionario(tipoChave: string, tipoValor: string): string {
        return `dicionario<${tipoChave},${tipoValor}>`;
    }

    private obterTiposDicionario(tipo: string): { chave: string; valor: string } {
        if (!this.tipoEhDicionario(tipo)) {
            throw new ErroCompilador(`Tipo '${tipo}' não é um dicionário.`);
        }

        const conteudo = tipo.slice('dicionario<'.length, -1);
        const separador = conteudo.indexOf(',');
        return {
            chave: conteudo.slice(0, separador),
            valor: conteudo.slice(separador + 1),
        };
    }

    private mapearTipoElementoCil(tipoDelegua: string): string {
        return this.mapearTipoCil(tipoDelegua);
    }

    private mapearTipoVetorCil(tipoElementoDelegua: string): string {
        return `class [mscorlib]System.Collections.Generic.List\`1<${this.mapearTipoElementoCil(tipoElementoDelegua)}>`;
    }

    private mapearTipoDicionarioCil(tipoChaveDelegua: string, tipoValorDelegua: string): string {
        return `class [mscorlib]System.Collections.Generic.Dictionary\`2<${this.mapearTipoElementoCil(tipoChaveDelegua)}, ${this.mapearTipoElementoCil(tipoValorDelegua)}>`;
    }

    private emitirCarregamentoVariavel(local: VariavelLocal): void {
        this.instrucoes.push(`${local.armazenamento === 'argumento' ? 'ldarg' : 'ldloc'} ${local.indice}`);
    }

    private emitirArmazenamentoVariavel(local: VariavelLocal): void {
        this.instrucoes.push(`${local.armazenamento === 'argumento' ? 'starg' : 'stloc'} ${local.indice}`);
    }

    private tiposCompativeisParaIgualdade(tipoEsquerdo: string, tipoDireito: string): boolean {
        if (this.tipoEhNumerico(tipoEsquerdo) && this.tipoEhNumerico(tipoDireito)) {
            return true;
        }

        return tipoEsquerdo === tipoDireito && ['texto', 'logico'].includes(tipoEsquerdo);
    }

    private gerarRotulo(): string {
        const sufixo = this.proximoRotulo.toString().padStart(4, '0');
        this.proximoRotulo += 1;
        return `IL_${sufixo}`;
    }

    private emitirRotulo(rotulo: string): void {
        this.instrucoes.push(`${rotulo}:`);
    }

    private reservarLocalTemporario(tipoDelegua: string): VariavelLocal {
        const local = {
            indice: this.proximoIndiceLocal++,
            tipoCil: this.mapearTipoCil(tipoDelegua),
            tipoDelegua,
            armazenamento: 'local' as const,
        };

        this.locaisTemporarios.push(local);
        return local;
    }

    private rotuloLoopAtual(): { continua: string; sustar: string } {
        const rotulos = this.pilhaRotulosLoop[this.pilhaRotulosLoop.length - 1];
        if (!rotulos) {
            throw new ErroCompilador('`continua` e `sustar` só podem ser usados dentro de laços de repetição.');
        }

        return rotulos;
    }

    private construtoDeixaValorNaPilha(construto: any): boolean {
        if (construto instanceof Atribuir || construto instanceof AtribuicaoPorIndice) {
            return false;
        }

        if (construto instanceof Chamada) {
            try {
                return this.resolverTipoConstruto(construto) !== 'vazio';
            } catch {
                return true;
            }
        }

        return true;
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

    private async emitirComparacaoIgualdadeComLocal(local: VariavelLocal, construto: any): Promise<void> {
        const tipoConstruto = this.resolverTipoConstruto(construto);

        if (!this.tiposCompativeisParaIgualdade(local.tipoDelegua, tipoConstruto)) {
            throw new ErroCompilador(
                `Não pode comparar valor do tipo '${local.tipoDelegua}' com caso do tipo '${tipoConstruto}' em 'escolha'.`
            );
        }

        if (this.tipoEhNumerico(local.tipoDelegua) && this.tipoEhNumerico(tipoConstruto)) {
            const tipoPrevalente = local.tipoDelegua === 'numero' || tipoConstruto === 'numero' ? 'numero' : 'inteiro';
            this.instrucoes.push(`ldloc ${local.indice}`);
            if (local.tipoDelegua !== tipoPrevalente) {
                this.instrucoes.push('conv.r8');
            }

            await construto.aceitar(this as any);
            if (tipoConstruto !== tipoPrevalente) {
                this.instrucoes.push('conv.r8');
            }

            this.instrucoes.push('ceq');
            return;
        }

        this.instrucoes.push(`ldloc ${local.indice}`);
        await construto.aceitar(this as any);

        if (local.tipoDelegua === 'texto') {
            this.instrucoes.push('call bool [mscorlib]System.String::op_Equality(string, string)');
            return;
        }

        this.instrucoes.push('ceq');
    }

    private mapearTipoCil(tipoDelegua: string): string {
        if (this.tipoEhVetor(tipoDelegua)) {
            return this.mapearTipoVetorCil(this.obterTipoElementoVetor(tipoDelegua));
        }

        if (this.tipoEhDicionario(tipoDelegua)) {
            const tipos = this.obterTiposDicionario(tipoDelegua);
            return this.mapearTipoDicionarioCil(tipos.chave, tipos.valor);
        }

        const tipoCil = MAPA_TIPOS_CIL[tipoDelegua];
        if (!tipoCil) {
            throw new ErroCompilador(`Tipo '${tipoDelegua}' não implementado para .NET.`);
        }
        return tipoCil;
    }

    private extrairTipoRetornoFuncao(declaracao: FuncaoDeclaracao): string {
        const tipoExplicito = declaracao.funcao.tipo;
        if (tipoExplicito && tipoExplicito !== 'qualquer') {
            return this.normalizarTipo(tipoExplicito);
        }

        for (const item of declaracao.funcao.corpo) {
            if (item instanceof Retorna) {
                return this.normalizarTipo(item.tipo || 'vazio');
            }
        }

        return 'vazio';
    }

    private registrarAssinaturaFuncao(declaracao: FuncaoDeclaracao): void {
        const nome = declaracao.simbolo.lexema;
        if (this.funcoes.has(nome)) {
            throw new ErroCompilador(`Função '${nome}' já declarada.`);
        }

        const parametros = declaracao.funcao.parametros.map((parametro: any) => {
            const tipoDelegua = this.normalizarTipo(parametro.tipoDado || 'qualquer');
            if (tipoDelegua === 'qualquer') {
                throw new ErroCompilador(`Função '${nome}' requer tipos explícitos de parâmetros nesta fase do compilador.`);
            }

            return {
                nome: parametro.nome.lexema,
                tipoDelegua,
                tipoCil: this.mapearTipoCil(tipoDelegua),
            };
        });

        const tipoRetornoDelegua = this.extrairTipoRetornoFuncao(declaracao);
        this.funcoes.set(nome, {
            nome,
            nomeCil: nome,
            tipoRetornoDelegua,
            tipoRetornoCil: this.mapearTipoCil(tipoRetornoDelegua),
            parametros,
        });
    }

    private capturarEstadoCompilacao(): EstadoCompilacao {
        return {
            instrucoes: this.instrucoes,
            variaveis: this.variaveis,
            locaisTemporarios: this.locaisTemporarios,
            proximoIndiceLocal: this.proximoIndiceLocal,
            pilhaRotulosLoop: this.pilhaRotulosLoop,
            funcaoAtual: this.funcaoAtual,
        };
    }

    private restaurarEstadoCompilacao(estado: EstadoCompilacao): void {
        this.instrucoes = estado.instrucoes;
        this.variaveis = estado.variaveis;
        this.locaisTemporarios = estado.locaisTemporarios;
        this.proximoIndiceLocal = estado.proximoIndiceLocal;
        this.pilhaRotulosLoop = estado.pilhaRotulosLoop;
        this.funcaoAtual = estado.funcaoAtual;
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
        if (construto instanceof Vetor) {
            const elementos = construto.elementos || [];
            if (elementos.length === 0) {
                if (construto.tipo) {
                    return this.normalizarTipoVetor(construto.tipo);
                }

                throw new ErroCompilador('Não foi possível deduzir o tipo de um vetor vazio.');
            }

            const tipoElemento = this.resolverTipoConstruto(elementos[0]);
            for (let indice = 1; indice < elementos.length; indice++) {
                const tipoAtual = this.resolverTipoConstruto(elementos[indice]);
                const tiposCompativeis =
                    tipoAtual === tipoElemento ||
                    (this.tipoEhNumerico(tipoElemento) && this.tipoEhNumerico(tipoAtual));

                if (!tiposCompativeis) {
                    throw new ErroCompilador('Vetor com elementos de tipos incompatíveis não é suportado nesta fase do compilador.');
                }
            }

            const tipoNormalizado = this.tipoEhNumerico(tipoElemento)
                ? elementos.some((elemento: any) => this.resolverTipoConstruto(elemento) === 'numero')
                    ? 'numero'
                    : 'inteiro'
                : tipoElemento;

            return `${tipoNormalizado}[]`;
        }
        if (construto instanceof Dicionario) {
            if (!construto.chaves.length) {
                throw new ErroCompilador('Não foi possível deduzir o tipo de um dicionário vazio.');
            }

            const tipoChave = 'texto';
            const primeiraChave = construto.chaves[0];
            if (!(primeiraChave instanceof Literal) || this.resolverTipoConstruto(primeiraChave) !== 'texto') {
                throw new ErroCompilador('Dicionários suportam apenas chaves de texto nesta fase do compilador.');
            }

            const tipoPrimeiroValor = this.resolverTipoConstruto(construto.valores[0]);
            let tipoValor = tipoPrimeiroValor;
            for (let indice = 0; indice < construto.chaves.length; indice++) {
                const chaveAtual = construto.chaves[indice];
                if (!(chaveAtual instanceof Literal) || this.resolverTipoConstruto(chaveAtual) !== 'texto') {
                    throw new ErroCompilador('Dicionários suportam apenas chaves de texto nesta fase do compilador.');
                }

                const tipoAtual = this.resolverTipoConstruto(construto.valores[indice]);
                const tiposCompativeis =
                    tipoAtual === tipoValor || (this.tipoEhNumerico(tipoValor) && this.tipoEhNumerico(tipoAtual));
                if (!tiposCompativeis) {
                    throw new ErroCompilador('Dicionário com valores de tipos incompatíveis não é suportado nesta fase do compilador.');
                }

                if (tipoAtual === 'numero') {
                    tipoValor = 'numero';
                }
            }

            return this.criarTipoDicionario(tipoChave, tipoValor);
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
        if (construto instanceof Chamada) {
            if (!(construto.entidadeChamada instanceof Variavel)) {
                throw new ErroCompilador('Chamada suportada apenas para funções nomeadas nesta fase do compilador.');
            }

            const funcao = this.funcoes.get(construto.entidadeChamada.simbolo.lexema);
            if (!funcao) {
                throw new ErroCompilador(`Função '${construto.entidadeChamada.simbolo.lexema}' não declarada.`);
            }

            return funcao.tipoRetornoDelegua;
        }
        if (construto instanceof AcessoIndiceVariavel) {
            const tipoEntidade = this.resolverTipoConstruto(construto.entidadeChamada);
            if (this.tipoEhVetor(tipoEntidade)) {
                return this.obterTipoElementoVetor(tipoEntidade);
            }

            if (this.tipoEhDicionario(tipoEntidade)) {
                return this.obterTiposDicionario(tipoEntidade).valor;
            }

            throw new ErroCompilador('Acesso por índice suportado apenas para vetores e dicionários nesta fase do compilador.');
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
        const local = { indice, tipoCil, tipoDelegua, armazenamento: 'local' as const };
        this.variaveis.set(declaracao.simbolo.lexema, local);
        this.emitirArmazenamentoVariavel(local);
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

    async visitarExpressaoVetor(expressao: Vetor): Promise<string> {
        const tipoVetor = this.resolverTipoConstruto(expressao);
        const tipoElemento = this.obterTipoElementoVetor(tipoVetor);
        const tipoElementoCil = this.mapearTipoElementoCil(tipoElemento);
        const tipoVetorCil = this.mapearTipoVetorCil(tipoElemento);

        this.instrucoes.push(`newobj instance void ${tipoVetorCil}::.ctor()`);

        for (const elemento of expressao.elementos) {
            const tipoAtual = this.resolverTipoConstruto(elemento);
            this.instrucoes.push('dup');
            await elemento.aceitar(this as any);
            if (tipoElemento === 'numero' && tipoAtual === 'inteiro') {
                this.instrucoes.push('conv.r8');
            }
            this.instrucoes.push(`callvirt instance void ${tipoVetorCil}::Add(${tipoElementoCil})`);
        }

        return tipoVetor;
    }

    async visitarExpressaoDicionario(expressao: Dicionario): Promise<string> {
        const tipoDicionario = this.resolverTipoConstruto(expressao);
        const tipos = this.obterTiposDicionario(tipoDicionario);
        const tipoDicionarioCil = this.mapearTipoDicionarioCil(tipos.chave, tipos.valor);
        const tipoValorCil = this.mapearTipoElementoCil(tipos.valor);

        this.instrucoes.push(`newobj instance void ${tipoDicionarioCil}::.ctor()`);

        for (let indice = 0; indice < expressao.chaves.length; indice++) {
            this.instrucoes.push('dup');
            const chave = expressao.chaves[indice] as Literal;
            this.instrucoes.push(`ldstr "${this.escaparTexto(chave.valor as string)}"`);

            const valor = expressao.valores[indice];
            const tipoValorAtual = this.resolverTipoConstruto(valor);
            await valor.aceitar(this as any);
            if (tipos.valor === 'numero' && tipoValorAtual === 'inteiro') {
                this.instrucoes.push('conv.r8');
            }

            this.instrucoes.push(`callvirt instance void ${tipoDicionarioCil}::Add(string, ${tipoValorCil})`);
        }

        return tipoDicionario;
    }

    async visitarExpressaoDeVariavel(expressao: Variavel): Promise<string> {
        const local = this.variaveis.get(expressao.simbolo.lexema);
        if (!local) throw new ErroCompilador(`Variável '${expressao.simbolo.lexema}' não declarada.`);
        this.emitirCarregamentoVariavel(local);
        return local.tipoDelegua;
    }

    async visitarExpressaoAcessoIndiceVariavel(expressao: AcessoIndiceVariavel): Promise<string> {
        const tipoEntidade = this.resolverTipoConstruto(expressao.entidadeChamada);
        if (this.tipoEhVetor(tipoEntidade)) {
            const tipoElemento = this.obterTipoElementoVetor(tipoEntidade);
            const tipoVetorCil = this.mapearTipoVetorCil(tipoElemento);
            const tipoElementoCil = this.mapearTipoElementoCil(tipoElemento);
            const tipoIndice = this.resolverTipoConstruto(expressao.indice);
            if (!this.tipoEhNumerico(tipoIndice)) {
                throw new ErroCompilador('Índice de vetor deve ser numérico.');
            }

            await expressao.entidadeChamada.aceitar(this as any);
            await expressao.indice.aceitar(this as any);
            if (tipoIndice === 'numero') {
                throw new ErroCompilador('Índice de vetor deve ser inteiro nesta fase do compilador.');
            }

            this.instrucoes.push(`callvirt instance ${tipoElementoCil} ${tipoVetorCil}::get_Item(int32)`);
            return tipoElemento;
        }

        if (this.tipoEhDicionario(tipoEntidade)) {
            const tipos = this.obterTiposDicionario(tipoEntidade);
            const tipoIndice = this.resolverTipoConstruto(expressao.indice);
            if (tipoIndice !== tipos.chave) {
                throw new ErroCompilador(`Índice de dicionário deve ser '${tipos.chave}'.`);
            }

            await expressao.entidadeChamada.aceitar(this as any);
            await expressao.indice.aceitar(this as any);
            this.instrucoes.push(
                `callvirt instance ${this.mapearTipoElementoCil(tipos.valor)} ${this.mapearTipoDicionarioCil(tipos.chave, tipos.valor)}::get_Item(${this.mapearTipoElementoCil(tipos.chave)})`
            );
            return tipos.valor;
        }

        throw new ErroCompilador('Acesso por índice suportado apenas para vetores e dicionários nesta fase do compilador.');
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

        this.emitirArmazenamentoVariavel(local);
        return local.tipoDelegua;
    }

    async visitarExpressaoAtribuicaoPorIndice(expressao: AtribuicaoPorIndice): Promise<any> {
        const tipoObjeto = this.resolverTipoConstruto(expressao.objeto);
        if (this.tipoEhVetor(tipoObjeto)) {
            const tipoElemento = this.obterTipoElementoVetor(tipoObjeto);
            const tipoIndice = this.resolverTipoConstruto(expressao.indice);
            if (!this.tipoEhNumerico(tipoIndice) || tipoIndice === 'numero') {
                throw new ErroCompilador('Índice de vetor deve ser inteiro nesta fase do compilador.');
            }

            const tipoValor = this.resolverTipoConstruto(expressao.valor);
            const tipoCompativel =
                tipoValor === tipoElemento || (tipoElemento === 'numero' && tipoValor === 'inteiro');
            if (!tipoCompativel) {
                throw new ErroCompilador(
                    `Não pode atribuir valor do tipo '${tipoValor}' a vetor de elementos '${tipoElemento}'.`
                );
            }

            const tipoVetorCil = this.mapearTipoVetorCil(tipoElemento);
            const tipoElementoCil = this.mapearTipoElementoCil(tipoElemento);

            await expressao.objeto.aceitar(this as any);
            await expressao.indice.aceitar(this as any);
            await expressao.valor.aceitar(this as any);
            if (tipoElemento === 'numero' && tipoValor === 'inteiro') {
                this.instrucoes.push('conv.r8');
            }

            this.instrucoes.push(`callvirt instance void ${tipoVetorCil}::set_Item(int32, ${tipoElementoCil})`);
            return;
        }

        if (this.tipoEhDicionario(tipoObjeto)) {
            const tipos = this.obterTiposDicionario(tipoObjeto);
            const tipoIndice = this.resolverTipoConstruto(expressao.indice);
            if (tipoIndice !== tipos.chave) {
                throw new ErroCompilador(`Índice de dicionário deve ser '${tipos.chave}'.`);
            }

            const tipoValor = this.resolverTipoConstruto(expressao.valor);
            const tipoCompativel =
                tipoValor === tipos.valor || (tipos.valor === 'numero' && tipoValor === 'inteiro');
            if (!tipoCompativel) {
                throw new ErroCompilador(
                    `Não pode atribuir valor do tipo '${tipoValor}' a dicionário de valores '${tipos.valor}'.`
                );
            }

            const tipoDicionarioCil = this.mapearTipoDicionarioCil(tipos.chave, tipos.valor);
            const tipoChaveCil = this.mapearTipoElementoCil(tipos.chave);
            const tipoValorCil = this.mapearTipoElementoCil(tipos.valor);

            await expressao.objeto.aceitar(this as any);
            await expressao.indice.aceitar(this as any);
            await expressao.valor.aceitar(this as any);
            if (tipos.valor === 'numero' && tipoValor === 'inteiro') {
                this.instrucoes.push('conv.r8');
            }

            this.instrucoes.push(`callvirt instance void ${tipoDicionarioCil}::set_Item(${tipoChaveCil}, ${tipoValorCil})`);
            return;
        }

        throw new ErroCompilador('Atribuição por índice suportada apenas para vetores e dicionários nesta fase do compilador.');
    }

    async visitarExpressaoDeChamada(expressao: Chamada): Promise<string> {
        if (!(expressao.entidadeChamada instanceof Variavel)) {
            throw new ErroCompilador('Chamada suportada apenas para funções nomeadas nesta fase do compilador.');
        }

        const funcao = this.funcoes.get(expressao.entidadeChamada.simbolo.lexema);
        if (!funcao) {
            throw new ErroCompilador(`Função '${expressao.entidadeChamada.simbolo.lexema}' não declarada.`);
        }

        if (expressao.argumentos.length !== funcao.parametros.length) {
            throw new ErroCompilador(
                `Função '${funcao.nome}' espera ${funcao.parametros.length} argumento(s), mas recebeu ${expressao.argumentos.length}.`
            );
        }

        for (let indice = 0; indice < expressao.argumentos.length; indice++) {
            const argumento = expressao.argumentos[indice];
            const parametro = funcao.parametros[indice];
            const tipoArgumento = this.resolverTipoConstruto(argumento);
            const tipoCompativel =
                tipoArgumento === parametro.tipoDelegua ||
                (parametro.tipoDelegua === 'numero' && tipoArgumento === 'inteiro');

            if (!tipoCompativel) {
                throw new ErroCompilador(
                    `Argumento ${indice + 1} da função '${funcao.nome}' deve ser '${parametro.tipoDelegua}', mas recebeu '${tipoArgumento}'.`
                );
            }

            await argumento.aceitar(this as any);
            if (parametro.tipoDelegua === 'numero' && tipoArgumento === 'inteiro') {
                this.instrucoes.push('conv.r8');
            }
        }

        this.instrucoes.push(
            `call ${funcao.tipoRetornoCil} Programa::${funcao.nomeCil}(${funcao.parametros.map((p) => p.tipoCil).join(', ')})`
        );
        return funcao.tipoRetornoDelegua;
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

    async visitarDeclaracaoEscolha(declaracao: Escolha): Promise<any> {
        const tipoEscolha = this.resolverTipoConstruto(declaracao.identificadorOuLiteral);
        if (!['inteiro', 'numero', 'texto', 'logico'].includes(tipoEscolha)) {
            throw new ErroCompilador(`Tipo '${tipoEscolha}' não suportado em 'escolha'.`);
        }

        const localEscolha = this.reservarLocalTemporario(tipoEscolha);
        await declaracao.identificadorOuLiteral.aceitar(this as any);
        this.emitirArmazenamentoVariavel(localEscolha);

        const rotuloFim = this.gerarRotulo();

        for (const caminho of declaracao.caminhos) {
            const rotuloExecutar = this.gerarRotulo();
            const rotuloProximoCaminho = this.gerarRotulo();

            for (const condicao of caminho.condicoes) {
                await this.emitirComparacaoIgualdadeComLocal(localEscolha, condicao);
                this.instrucoes.push(`brtrue ${rotuloExecutar}`);
            }

            this.instrucoes.push(`br ${rotuloProximoCaminho}`);
            this.emitirRotulo(rotuloExecutar);

            for (const item of caminho.declaracoes) {
                await item.aceitar(this as any);
            }

            this.instrucoes.push(`br ${rotuloFim}`);
            this.emitirRotulo(rotuloProximoCaminho);
        }

        if (declaracao.caminhoPadrao?.declaracoes) {
            for (const item of declaracao.caminhoPadrao.declaracoes) {
                await item.aceitar(this as any);
            }
        }

        this.emitirRotulo(rotuloFim);
    }

    async visitarDeclaracaoDefinicaoFuncao(declaracao: FuncaoDeclaracao): Promise<any> {
        if (this.funcaoAtual) {
            throw new ErroCompilador('Funções aninhadas ainda não são suportadas neste compilador.');
        }

        const funcao = this.funcoes.get(declaracao.simbolo.lexema);
        if (!funcao) {
            throw new ErroCompilador(`Função '${declaracao.simbolo.lexema}' não registrada.`);
        }

        const estadoAnterior = this.capturarEstadoCompilacao();
        this.instrucoes = [];
        this.variaveis = new Map();
        this.locaisTemporarios = [];
        this.proximoIndiceLocal = 0;
        this.pilhaRotulosLoop = [];
        this.funcaoAtual = funcao;

        try {
            for (let indice = 0; indice < funcao.parametros.length; indice++) {
                const parametro = funcao.parametros[indice];
                this.variaveis.set(parametro.nome, {
                    indice,
                    tipoCil: parametro.tipoCil,
                    tipoDelegua: parametro.tipoDelegua,
                    armazenamento: 'argumento',
                });
            }

            for (const item of declaracao.funcao.corpo) {
                await item.aceitar(this as any);
            }

            if (funcao.tipoRetornoDelegua === 'vazio') {
                this.instrucoes.push('ret');
            }

            const locaisOrdenados = [
                ...Array.from(this.variaveis.values()).filter((variavel) => variavel.armazenamento === 'local'),
                ...this.locaisTemporarios,
            ].sort((a, b) => a.indice - b.indice);
            const linhaLocais = locaisOrdenados.length
                ? `    .locals init (${locaisOrdenados.map((local) => `${local.tipoCil} V_${local.indice}`).join(', ')})\n`
                : '';
            const corpo = this.instrucoes.map((instrucao) => `    ${instrucao}`).join('\n');

            this.metodosCompilados.push(
                `.method public static ${funcao.tipoRetornoCil} ${funcao.nomeCil}(${funcao.parametros
                    .map((parametro) => `${parametro.tipoCil} ${parametro.nome}`)
                    .join(', ')}) cil managed\n` +
                    `{\n` +
                    `    .maxstack 8\n` +
                    linhaLocais +
                    (corpo ? corpo + '\n' : '') +
                    `}`
            );
        } finally {
            this.restaurarEstadoCompilacao(estadoAnterior);
        }
    }

    async visitarDeclaracaoEnquanto(declaracao: Enquanto): Promise<any> {
        const rotuloInicio = this.gerarRotulo();
        const rotuloFim = this.gerarRotulo();

        this.emitirRotulo(rotuloInicio);
        await this.emitirSaltoCondicional(declaracao.condicao, rotuloFim, false);

        this.pilhaRotulosLoop.push({ continua: rotuloInicio, sustar: rotuloFim });
        try {
            await declaracao.corpo.aceitar(this as any);
        } finally {
            this.pilhaRotulosLoop.pop();
        }

        this.instrucoes.push(`br ${rotuloInicio}`);
        this.emitirRotulo(rotuloFim);
    }

    async visitarDeclaracaoPara(declaracao: Para): Promise<any> {
        const inicializador = Array.isArray(declaracao.inicializador)
            ? declaracao.inicializador[0]
            : declaracao.inicializador;

        if (inicializador) {
            await inicializador.aceitar(this as any);
        }

        const rotuloInicio = this.gerarRotulo();
        const rotuloIncremento = this.gerarRotulo();
        const rotuloFim = this.gerarRotulo();

        this.emitirRotulo(rotuloInicio);

        if (declaracao.condicao) {
            await this.emitirSaltoCondicional(declaracao.condicao, rotuloFim, false);
        }

        this.pilhaRotulosLoop.push({ continua: rotuloIncremento, sustar: rotuloFim });
        try {
            await declaracao.corpo.aceitar(this as any);
        } finally {
            this.pilhaRotulosLoop.pop();
        }

        this.emitirRotulo(rotuloIncremento);

        if (declaracao.incrementar) {
            await declaracao.incrementar.aceitar(this as any);
            if (this.construtoDeixaValorNaPilha(declaracao.incrementar)) {
                this.instrucoes.push('pop');
            }
        }

        this.instrucoes.push(`br ${rotuloInicio}`);
        this.emitirRotulo(rotuloFim);
    }

    async visitarExpressaoContinua(): Promise<any> {
        this.instrucoes.push(`br ${this.rotuloLoopAtual().continua}`);
    }

    async visitarExpressaoSustar(): Promise<any> {
        this.instrucoes.push(`br ${this.rotuloLoopAtual().sustar}`);
    }

    async visitarExpressaoRetornar(declaracao: Retorna): Promise<any> {
        if (!this.funcaoAtual) {
            throw new ErroCompilador('`retorna` só pode ser usado dentro de funções.');
        }

        if (this.funcaoAtual.tipoRetornoDelegua === 'vazio') {
            if (declaracao.valor) {
                throw new ErroCompilador(`Função '${this.funcaoAtual.nome}' não deve retornar valor.`);
            }

            this.instrucoes.push('ret');
            return;
        }

        if (!declaracao.valor) {
            throw new ErroCompilador(`Função '${this.funcaoAtual.nome}' deve retornar valor.`);
        }

        const tipoValor = this.resolverTipoConstruto(declaracao.valor);
        const tipoCompativel =
            tipoValor === this.funcaoAtual.tipoRetornoDelegua ||
            (this.funcaoAtual.tipoRetornoDelegua === 'numero' && tipoValor === 'inteiro');

        if (!tipoCompativel) {
            throw new ErroCompilador(
                `Função '${this.funcaoAtual.nome}' retorna '${this.funcaoAtual.tipoRetornoDelegua}', mas recebeu '${tipoValor}'.`
            );
        }

        await declaracao.valor.aceitar(this as any);
        if (this.funcaoAtual.tipoRetornoDelegua === 'numero' && tipoValor === 'inteiro') {
            this.instrucoes.push('conv.r8');
        }

        this.instrucoes.push('ret');
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
