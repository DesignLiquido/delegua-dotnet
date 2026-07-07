import { Agrupamento, AvaliadorSintatico, Binario, Declaracao, Escreva, Lexador, Literal, Var, Variavel } from '@designliquido/delegua';

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
 * Primeira fatia vertical do compilador Delégua → CIL (.NET).
 * Suporta apenas: `var` com literais, leitura de variáveis, aritmética
 * (`+ - * /`) entre `inteiro`/`numero`, e `escreva`. Todo o restante da
 * gramática lança `ErroCompilador` (ver `VisitanteBaseNaoImplementado`).
 */
export class CompiladorDotnet extends VisitanteBaseNaoImplementado {
    lexador: Lexador;
    avaliadorSintatico: AvaliadorSintatico;

    private instrucoes: string[];
    private variaveis: Map<string, VariavelLocal>;
    private proximoIndiceLocal: number;

    constructor() {
        super();
        this.lexador = new Lexador();
        this.avaliadorSintatico = new AvaliadorSintatico();
    }

    async compilar(codigo: string[]): Promise<string> {
        this.instrucoes = [];
        this.variaveis = new Map();
        this.proximoIndiceLocal = 0;

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
        if (construto instanceof Binario) {
            if (construto.operador.tipo === 'DIVISAO') return 'numero';
            const tipoEsquerdo = this.resolverTipoConstruto(construto.esquerda);
            const tipoDireito = this.resolverTipoConstruto(construto.direita);
            return tipoEsquerdo === 'numero' || tipoDireito === 'numero' ? 'numero' : 'inteiro';
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
