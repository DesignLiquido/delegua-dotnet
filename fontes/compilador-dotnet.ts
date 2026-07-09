import {
    AcessoMetodo,
    AcessoMetodoOuPropriedade,
    AcessoIndiceVariavel,
    AtribuicaoPorIndice,
    Agrupamento,
    Atribuir,
    AvaliadorSintatico,
    Binario,
    Bloco,
    Chamada,
    Classe,
    Declaracao,
    DefinirValor,
    Dicionario,
    Enquanto,
    Escolha,
    Escreva,
    Expressao,
    Falhar,
    FormatacaoEscrita,
    FuncaoDeclaracao,
    Isto,
    Lexador,
    Literal,
    Logico,
    Para,
    Retorna,
    Se,
    Super,
    TuplaN,
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

interface MetodoClasseCompilado {
    nome: string;
    nomeCil: string;
    tipoRetornoDelegua: string;
    tipoRetornoCil: string;
    parametros: ParametroCompilado[];
    eConstrutor: boolean;
    sintetico?: boolean;
}

interface CampoClasseCompilado {
    nome: string;
    tipoDelegua: string;
    tipoCil: string;
}

interface ClasseCompilada {
    nome: string;
    superClasseNome: string | null;
    metodos: Map<string, MetodoClasseCompilado>;
    campos: Map<string, CampoClasseCompilado>;
}

interface EstadoCompilacao {
    instrucoes: string[];
    variaveis: Map<string, VariavelLocal>;
    locaisTemporarios: VariavelLocal[];
    proximoIndiceLocal: number;
    pilhaRotulosLoop: Array<{ continua: string; sustar: string }>;
    funcaoAtual: FuncaoCompilada | null;
    classeAtual: ClasseCompilada | null;
    metodoClasseAtual: MetodoClasseCompilado | null;
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
    private classes: Map<string, ClasseCompilada>;
    private metodosCompilados: string[];
    private classesCompiladas: string[];
    private funcaoAtual: FuncaoCompilada | null;
    private classeAtual: ClasseCompilada | null;
    private metodoClasseAtual: MetodoClasseCompilado | null;

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
        this.classes = new Map();
        this.metodosCompilados = [];
        this.classesCompiladas = [];
        this.funcaoAtual = null;
        this.classeAtual = null;
        this.metodoClasseAtual = null;

        const retornoLexador = this.lexador.mapear(codigo, -1);
        const retornoAvaliadorSintatico = await this.avaliadorSintatico.analisar(retornoLexador, -1);
        const declaracoes = retornoAvaliadorSintatico.declaracoes as Declaracao[];

        for (const declaracao of declaracoes) {
            if (declaracao instanceof Classe) {
                this.registrarClasse(declaracao);
            }

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
            (this.metodosCompilados.length ? `\n${this.metodosCompilados.join('\n\n')}\n` : '') +
            (this.classesCompiladas.length ? `\n${this.classesCompiladas.join('\n\n')}\n` : '')
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

    private tipoEhPrimitivoSuportado(tipo: string): boolean {
        return ['inteiro', 'numero', 'logico', 'texto'].includes(tipo);
    }

    private tipoEhTexto(tipo: string): boolean {
        return tipo === 'texto';
    }

    private tipoEhTupla(tipo: string): boolean {
        return tipo.endsWith('()');
    }

    private obterTipoElementoTupla(tipo: string): string {
        if (!this.tipoEhTupla(tipo)) {
            throw new ErroCompilador(`Tipo '${tipo}' não é uma tupla.`);
        }

        return this.normalizarTipo(tipo.slice(0, -2));
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

    private resolverTipoPrimitivoHomogeneo(construtos: any[], contexto: string): string {
        if (!construtos.length) {
            throw new ErroCompilador(`Não foi possível deduzir o tipo de ${contexto} vazio.`);
        }

        let tipo = this.resolverTipoConstruto(construtos[0]);
        if (!this.tipoEhPrimitivoSuportado(tipo)) {
            throw new ErroCompilador(`${contexto} suporta apenas tipos primitivos nesta fase do compilador.`);
        }

        for (let indice = 1; indice < construtos.length; indice++) {
            const tipoAtual = this.resolverTipoConstruto(construtos[indice]);
            const tiposCompativeis =
                tipoAtual === tipo || (this.tipoEhNumerico(tipo) && this.tipoEhNumerico(tipoAtual));

            if (!tiposCompativeis) {
                throw new ErroCompilador(`${contexto} com tipos incompatíveis não é suportado nesta fase do compilador.`);
            }

            if (tipoAtual === 'numero') {
                tipo = 'numero';
            }
        }

        return tipo;
    }

    private async emitirConstrutoParaTipoEsperado(construto: any, tipoEsperado: string): Promise<void> {
        const tipoAtual = this.resolverTipoConstruto(construto);
        await construto.aceitar(this as any);

        if (tipoEsperado === 'numero' && tipoAtual === 'inteiro') {
            this.instrucoes.push('conv.r8');
        }
    }

    private mapearTipoElementoCil(tipoDelegua: string): string {
        return this.mapearTipoCil(tipoDelegua);
    }

    private mapearTipoVetorCil(tipoElementoDelegua: string): string {
        return `class [mscorlib]System.Collections.Generic.List\`1<${this.mapearTipoElementoCil(tipoElementoDelegua)}>`;
    }

    private mapearTipoTuplaCil(tipoElementoDelegua: string): string {
        return `${this.mapearTipoElementoCil(tipoElementoDelegua)}[]`;
    }

    private mapearTipoDicionarioCil(tipoChaveDelegua: string, tipoValorDelegua: string): string {
        return `class [mscorlib]System.Collections.Generic.Dictionary\`2<${this.mapearTipoElementoCil(tipoChaveDelegua)}, ${this.mapearTipoElementoCil(tipoValorDelegua)}>`;
    }

    private mapearTipoColecaoChaves(tipoColecao: string): string {
        if (this.tipoEhVetor(tipoColecao)) {
            return 'inteiro[]';
        }

        if (this.tipoEhDicionario(tipoColecao)) {
            return `${this.obterTiposDicionario(tipoColecao).chave}[]`;
        }

        throw new ErroCompilador(`Tipo '${tipoColecao}' não possui chaves.`);
    }

    private mapearTipoColecaoValores(tipoColecao: string): string {
        if (this.tipoEhVetor(tipoColecao)) {
            return tipoColecao;
        }

        if (this.tipoEhDicionario(tipoColecao)) {
            return `${this.obterTiposDicionario(tipoColecao).valor}[]`;
        }

        throw new ErroCompilador(`Tipo '${tipoColecao}' não possui valores.`);
    }

    private emitirConstrucaoListaDeChavesDicionario(tipoColecao: string): void {
        const tipos = this.obterTiposDicionario(tipoColecao);
        const tipoLista = this.mapearTipoVetorCil(tipos.chave);
        const tipoDicionario = this.mapearTipoDicionarioCil(tipos.chave, tipos.valor);
        const tipoKeyCollection = `class [mscorlib]System.Collections.Generic.Dictionary\`2/KeyCollection<${this.mapearTipoElementoCil(tipos.chave)}, ${this.mapearTipoElementoCil(tipos.valor)}>`;

        this.instrucoes.push(`callvirt instance ${tipoKeyCollection} ${tipoDicionario}::get_Keys()`);
        this.instrucoes.push(`newobj instance void ${tipoLista}::.ctor(class [mscorlib]System.Collections.Generic.IEnumerable\`1<${this.mapearTipoElementoCil(tipos.chave)}>)`);
    }

    private emitirConstrucaoListaDeValoresDicionario(tipoColecao: string): void {
        const tipos = this.obterTiposDicionario(tipoColecao);
        const tipoLista = this.mapearTipoVetorCil(tipos.valor);
        const tipoDicionario = this.mapearTipoDicionarioCil(tipos.chave, tipos.valor);
        const tipoValueCollection = `class [mscorlib]System.Collections.Generic.Dictionary\`2/ValueCollection<${this.mapearTipoElementoCil(tipos.chave)}, ${this.mapearTipoElementoCil(tipos.valor)}>`;

        this.instrucoes.push(`callvirt instance ${tipoValueCollection} ${tipoDicionario}::get_Values()`);
        this.instrucoes.push(`newobj instance void ${tipoLista}::.ctor(class [mscorlib]System.Collections.Generic.IEnumerable\`1<${this.mapearTipoElementoCil(tipos.valor)}>)`);
    }

    private emitirCarregamentoTamanhoColecao(tipoColecao: string): void {
        if (this.tipoEhTexto(tipoColecao)) {
            this.instrucoes.push('callvirt instance int32 [mscorlib]System.String::get_Length()');
            return;
        }

        if (this.tipoEhTupla(tipoColecao)) {
            this.instrucoes.push('ldlen');
            this.instrucoes.push('conv.i4');
            return;
        }

        if (this.tipoEhVetor(tipoColecao)) {
            this.instrucoes.push(
                `callvirt instance int32 ${this.mapearTipoVetorCil(this.obterTipoElementoVetor(tipoColecao))}::get_Count()`
            );
            return;
        }

        if (this.tipoEhDicionario(tipoColecao)) {
            const tipos = this.obterTiposDicionario(tipoColecao);
            this.instrucoes.push(
                `callvirt instance int32 ${this.mapearTipoDicionarioCil(tipos.chave, tipos.valor)}::get_Count()`
            );
            return;
        }

        throw new ErroCompilador(`Tipo '${tipoColecao}' não possui 'tamanho'.`);
    }

    private emitirCarregamentoVariavel(local: VariavelLocal): void {
        this.instrucoes.push(`${local.armazenamento === 'argumento' ? 'ldarg' : 'ldloc'} ${local.indice}`);
    }

    private emitirArmazenamentoVariavel(local: VariavelLocal): void {
        this.instrucoes.push(`${local.armazenamento === 'argumento' ? 'starg' : 'stloc'} ${local.indice}`);
    }

    private emitirConversaoParaTexto(tipoDelegua: string): void {
        switch (tipoDelegua) {
            case 'texto':
                return;
            case 'inteiro':
                this.instrucoes.push('call instance string [mscorlib]System.Int32::ToString()');
                return;
            case 'numero':
                this.instrucoes.push('call instance string [mscorlib]System.Double::ToString()');
                return;
            case 'logico':
                this.instrucoes.push('call instance string [mscorlib]System.Boolean::ToString()');
                return;
            default:
                this.instrucoes.push('callvirt instance string [mscorlib]System.Object::ToString()');
        }
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
        if (construto instanceof Atribuir || construto instanceof AtribuicaoPorIndice || construto instanceof DefinirValor) {
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
        if (this.classes.has(tipoDelegua)) {
            return `class ${tipoDelegua}`;
        }

        if (this.tipoEhTupla(tipoDelegua)) {
            return this.mapearTipoTuplaCil(this.obterTipoElementoTupla(tipoDelegua));
        }

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

    private extrairTipoRetornoMetodoClasse(metodo: FuncaoDeclaracao): string {
        if (metodo.simbolo.lexema === 'construtor') {
            return 'vazio';
        }

        const tipoExplicito = metodo.funcao.tipo;
        if (tipoExplicito && tipoExplicito !== 'qualquer') {
            return this.normalizarTipo(tipoExplicito);
        }

        for (const item of metodo.funcao.corpo) {
            if (item instanceof Retorna) {
                return this.normalizarTipo(item.tipo || 'vazio');
            }
        }

        return 'vazio';
    }

    private registrarClasse(declaracao: Classe): void {
        const nome = declaracao.simbolo.lexema;
        if (this.classes.has(nome) || this.funcoes.has(nome)) {
            throw new ErroCompilador(`Classe '${nome}' já declarada.`);
        }

        if ((declaracao.superClasses?.length || 0) > 1) {
            throw new ErroCompilador(`Herança múltipla ainda não é suportada para a classe '${nome}'.`);
        }

        if (declaracao.implementa?.length) {
            throw new ErroCompilador(`Interfaces ainda não são suportadas para a classe '${nome}'.`);
        }

        if (declaracao.mesclas?.length) {
            throw new ErroCompilador(`Mesclas ainda não são suportadas para a classe '${nome}'.`);
        }

        if (declaracao.abstrata) {
            throw new ErroCompilador(`Classes abstratas ainda não são suportadas ('${nome}').`);
        }

        if (declaracao.classeEstatica) {
            throw new ErroCompilador(`Classes estáticas ainda não são suportadas ('${nome}').`);
        }

        const campos = new Map<string, CampoClasseCompilado>();
        for (const propriedade of declaracao.propriedades || []) {
            if (propriedade.estatico) {
                throw new ErroCompilador(`Propriedades estáticas ainda não são suportadas ('${nome}.${propriedade.nome.lexema}').`);
            }

            const nomePropriedade = propriedade.nome.lexema;
            if (campos.has(nomePropriedade)) {
                throw new ErroCompilador(`Propriedade '${nomePropriedade}' duplicada na classe '${nome}'.`);
            }

            const tipoPropriedade = this.normalizarTipo(propriedade.tipo || 'qualquer');
            if (tipoPropriedade === 'qualquer') {
                throw new ErroCompilador(`Propriedade '${nome}.${nomePropriedade}' requer tipo explícito nesta fase do compilador.`);
            }

            campos.set(nomePropriedade, {
                nome: nomePropriedade,
                tipoDelegua: tipoPropriedade,
                tipoCil: this.mapearTipoCil(tipoPropriedade),
            });
        }

        const metodos = new Map<string, MetodoClasseCompilado>();
        for (const metodo of declaracao.metodos) {
            const nomeMetodoOriginal = metodo.simbolo.lexema;
            if (metodos.has(nomeMetodoOriginal)) {
                throw new ErroCompilador(`Método '${nomeMetodoOriginal}' duplicado na classe '${nome}'.`);
            }

            if (metodo.estatico) {
                throw new ErroCompilador(`Métodos estáticos ainda não são suportados ('${nome}.${nomeMetodoOriginal}').`);
            }

            if (metodo.abstrato) {
                throw new ErroCompilador(`Métodos abstratos ainda não são suportados ('${nome}.${nomeMetodoOriginal}').`);
            }

            const parametros = metodo.funcao.parametros.map((parametro: any) => {
                const tipoDelegua = this.normalizarTipo(parametro.tipoDado || 'qualquer');
                if (tipoDelegua === 'qualquer') {
                    throw new ErroCompilador(`Método '${nomeMetodoOriginal}' da classe '${nome}' requer tipos explícitos de parâmetros.`);
                }

                return {
                    nome: parametro.nome.lexema,
                    tipoDelegua,
                    tipoCil: this.mapearTipoCil(tipoDelegua),
                };
            });

            const tipoRetornoDelegua = this.extrairTipoRetornoMetodoClasse(metodo);
            metodos.set(nomeMetodoOriginal, {
                nome: nomeMetodoOriginal,
                nomeCil: nomeMetodoOriginal === 'construtor' ? '.ctor' : nomeMetodoOriginal,
                tipoRetornoDelegua,
                tipoRetornoCil: this.mapearTipoCil(tipoRetornoDelegua),
                parametros,
                eConstrutor: nomeMetodoOriginal === 'construtor',
            });
        }

        if (!metodos.has('construtor')) {
            metodos.set('construtor', {
                nome: 'construtor',
                nomeCil: '.ctor',
                tipoRetornoDelegua: 'vazio',
                tipoRetornoCil: this.mapearTipoCil('vazio'),
                parametros: [],
                eConstrutor: true,
                sintetico: true,
            });
        }

        const superClasseNome = declaracao.superClasses?.[0]?.simbolo?.lexema || declaracao.superClasses?.[0]?.lexema || null;
        if (superClasseNome === nome) {
            throw new ErroCompilador(`Classe '${nome}' não pode herdar de si mesma.`);
        }

        this.classes.set(nome, {
            nome,
            superClasseNome,
            metodos,
            campos,
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
            classeAtual: this.classeAtual,
            metodoClasseAtual: this.metodoClasseAtual,
        };
    }

    private localizarMetodoClasse(nomeClasse: string, nomeMetodo: string): { classeDona: ClasseCompilada; metodo: MetodoClasseCompilado } | null {
        const visitados = new Set<string>();
        let classeAtual = this.classes.get(nomeClasse);

        while (classeAtual) {
            if (visitados.has(classeAtual.nome)) {
                throw new ErroCompilador(`Ciclo de herança detectado na classe '${nomeClasse}'.`);
            }

            visitados.add(classeAtual.nome);
            const metodo = classeAtual.metodos.get(nomeMetodo);
            if (metodo) {
                return { classeDona: classeAtual, metodo };
            }

            classeAtual = classeAtual.superClasseNome ? this.classes.get(classeAtual.superClasseNome) : undefined;
        }

        return null;
    }

    private localizarCampoClasse(nomeClasse: string, nomeCampo: string): { classeDona: ClasseCompilada; campo: CampoClasseCompilado } | null {
        const visitados = new Set<string>();
        let classeAtual = this.classes.get(nomeClasse);

        while (classeAtual) {
            if (visitados.has(classeAtual.nome)) {
                throw new ErroCompilador(`Ciclo de herança detectado na classe '${nomeClasse}'.`);
            }

            visitados.add(classeAtual.nome);
            const campo = classeAtual.campos.get(nomeCampo);
            if (campo) {
                return { classeDona: classeAtual, campo };
            }

            classeAtual = classeAtual.superClasseNome ? this.classes.get(classeAtual.superClasseNome) : undefined;
        }

        return null;
    }

    private restaurarEstadoCompilacao(estado: EstadoCompilacao): void {
        this.instrucoes = estado.instrucoes;
        this.variaveis = estado.variaveis;
        this.locaisTemporarios = estado.locaisTemporarios;
        this.proximoIndiceLocal = estado.proximoIndiceLocal;
        this.pilhaRotulosLoop = estado.pilhaRotulosLoop;
        this.funcaoAtual = estado.funcaoAtual;
        this.classeAtual = estado.classeAtual;
        this.metodoClasseAtual = estado.metodoClasseAtual;
    }

    private resolverTipoConstruto(construto: any): string {
        if (construto instanceof Isto) {
            if (!this.classeAtual) {
                throw new ErroCompilador("'isto' só pode ser usado dentro de métodos de classe.");
            }

            return this.classeAtual.nome;
        }

        if (construto instanceof Super) {
            if (!this.classeAtual) {
                throw new ErroCompilador("'super' só pode ser usado dentro de métodos de classe.");
            }

            if (!this.classeAtual.superClasseNome) {
                throw new ErroCompilador("'super' só pode ser usado em classes com herança.");
            }

            return this.classeAtual.superClasseNome;
        }

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
        if (construto instanceof TuplaN) {
            const elementos = construto.elementos || [];
            if (!elementos.length) {
                throw new ErroCompilador('Não foi possível deduzir o tipo de uma tupla vazia.');
            }

            const tipoElemento = this.resolverTipoConstruto(elementos[0]);
            for (let indice = 1; indice < elementos.length; indice++) {
                const tipoAtual = this.resolverTipoConstruto(elementos[indice]);
                const tiposCompativeis =
                    tipoAtual === tipoElemento ||
                    (this.tipoEhNumerico(tipoElemento) && this.tipoEhNumerico(tipoAtual));

                if (!tiposCompativeis) {
                    throw new ErroCompilador('Tupla com elementos de tipos incompatíveis não é suportada nesta fase do compilador.');
                }
            }

            const tipoNormalizado = this.tipoEhNumerico(tipoElemento)
                ? elementos.some((elemento: any) => this.resolverTipoConstruto(elemento) === 'numero')
                    ? 'numero'
                    : 'inteiro'
                : tipoElemento;

            return `${tipoNormalizado}()`;
        }
        if (construto instanceof Dicionario) {
            const tipoChave = this.resolverTipoPrimitivoHomogeneo(construto.chaves, 'dicionário');
            const tipoValor = this.resolverTipoPrimitivoHomogeneo(construto.valores, 'dicionário');
            return this.criarTipoDicionario(tipoChave, tipoValor);
        }
        if (construto instanceof FormatacaoEscrita) {
            return 'texto';
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
            if (construto.entidadeChamada instanceof AcessoMetodo) {
                const tipoObjeto = this.resolverTipoConstruto(construto.entidadeChamada.objeto);
                switch (construto.entidadeChamada.nomeMetodo) {
                    case 'maiusculo':
                    case 'maiúsculo':
                    case 'minusculo':
                    case 'minúsculo':
                    case 'substituir':
                    case 'aparar':
                    case 'apararInicio':
                    case 'apararFim':
                    case 'apararInício':
                    case 'concatenar':
                    case 'fatiar':
                    case 'subtexto':
                    case 'inverter':
                    case 'particao':
                    case 'partição':
                        if (!this.tipoEhTexto(tipoObjeto)) {
                            throw new ErroCompilador(`Método '${construto.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                        }

                        if (construto.entidadeChamada.nomeMetodo === 'particao' || construto.entidadeChamada.nomeMetodo === 'partição') {
                            return 'texto()';
                        }

                        return 'texto';
                    case 'contem':
                    case 'inclui':
                    case 'iniciaCom':
                    case 'terminaCom':
                    case 'tudoMaiusculo':
                    case 'tudoMaiúsculo':
                    case 'tudoMinusculo':
                    case 'tudoMinúsculo':
                        if (!this.tipoEhTexto(tipoObjeto)) {
                            throw new ErroCompilador(`Método '${construto.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                        }

                        return 'logico';
                    case 'encontrar':
                        if (!this.tipoEhTexto(tipoObjeto)) {
                            throw new ErroCompilador(`Método '${construto.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                        }

                        return 'inteiro';
                    case 'divida':
                    case 'dividir':
                        if (!this.tipoEhTexto(tipoObjeto)) {
                            throw new ErroCompilador(`Método '${construto.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                        }

                        return 'texto()';
                    case 'tamanho':
                        if (!this.tipoEhTexto(tipoObjeto) && !this.tipoEhVetor(tipoObjeto) && !this.tipoEhDicionario(tipoObjeto) && !this.tipoEhTupla(tipoObjeto)) {
                            throw new ErroCompilador(`Método '${construto.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                        }

                        return 'inteiro';
                    case 'adicionar':
                        return tipoObjeto;
                    case 'chaves':
                        return this.mapearTipoColecaoChaves(tipoObjeto);
                    case 'valores':
                        return this.mapearTipoColecaoValores(tipoObjeto);
                    default:
                        throw new ErroCompilador(`Método '${construto.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                }
            }

            if (construto.entidadeChamada instanceof AcessoMetodoOuPropriedade) {
                const tipoObjeto = this.resolverTipoConstruto(construto.entidadeChamada.objeto);

                const classe = this.classes.get(tipoObjeto);
                if (classe) {
                    const localizacaoMetodo = this.localizarMetodoClasse(classe.nome, construto.entidadeChamada.simbolo.lexema);
                    const metodoClasse = localizacaoMetodo?.metodo;
                    if (!metodoClasse || metodoClasse.eConstrutor) {
                        throw new ErroCompilador(`Método '${construto.entidadeChamada.simbolo.lexema}' não existe na classe '${tipoObjeto}'.`);
                    }

                    return metodoClasse.tipoRetornoDelegua;
                }

                switch (construto.entidadeChamada.simbolo.lexema) {
                    case 'maiusculo':
                    case 'maiúsculo':
                    case 'minusculo':
                    case 'minúsculo':
                    case 'substituir':
                    case 'aparar':
                    case 'apararInicio':
                    case 'apararFim':
                    case 'apararInício':
                    case 'concatenar':
                    case 'fatiar':
                    case 'subtexto':
                    case 'inverter':
                    case 'particao':
                    case 'partição':
                        if (!this.tipoEhTexto(tipoObjeto)) {
                            throw new ErroCompilador(`Método '${construto.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                        }

                        if (construto.entidadeChamada.simbolo.lexema === 'particao' || construto.entidadeChamada.simbolo.lexema === 'partição') {
                            return 'texto()';
                        }

                        return 'texto';
                    case 'contem':
                    case 'inclui':
                    case 'iniciaCom':
                    case 'terminaCom':
                    case 'tudoMaiusculo':
                    case 'tudoMaiúsculo':
                    case 'tudoMinusculo':
                    case 'tudoMinúsculo':
                        if (!this.tipoEhTexto(tipoObjeto)) {
                            throw new ErroCompilador(`Método '${construto.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                        }

                        return 'logico';
                    case 'encontrar':
                        if (!this.tipoEhTexto(tipoObjeto)) {
                            throw new ErroCompilador(`Método '${construto.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                        }

                        return 'inteiro';
                    case 'divida':
                    case 'dividir':
                        if (!this.tipoEhTexto(tipoObjeto)) {
                            throw new ErroCompilador(`Método '${construto.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                        }

                        return 'texto()';
                    case 'tamanho':
                        if (!this.tipoEhTexto(tipoObjeto) && !this.tipoEhVetor(tipoObjeto) && !this.tipoEhDicionario(tipoObjeto) && !this.tipoEhTupla(tipoObjeto)) {
                            throw new ErroCompilador(`Método '${construto.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                        }

                        return 'inteiro';
                    case 'chaves':
                        return this.mapearTipoColecaoChaves(tipoObjeto);
                    case 'valores':
                        return this.mapearTipoColecaoValores(tipoObjeto);
                    default:
                        throw new ErroCompilador(`Método '${construto.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
            }

            if (!(construto.entidadeChamada instanceof Variavel)) {
                if (construto.entidadeChamada instanceof Super) {
                    if (construto.argumentos.length !== 0) {
                        throw new ErroCompilador("'super()' não aceita argumentos nesta fase do compilador.");
                    }

                    return this.resolverTipoConstruto(construto.entidadeChamada);
                }

                throw new ErroCompilador('Chamada suportada apenas para funções nomeadas nesta fase do compilador.');
            }

            const classe = this.classes.get(construto.entidadeChamada.simbolo.lexema);
            if (classe) {
                return classe.nome;
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

            if (this.tipoEhTupla(tipoEntidade)) {
                return this.obterTipoElementoTupla(tipoEntidade);
            }

            if (this.tipoEhDicionario(tipoEntidade)) {
                return this.obterTiposDicionario(tipoEntidade).valor;
            }

            throw new ErroCompilador('Acesso por índice suportado apenas para vetores, tuplas e dicionários nesta fase do compilador.');
        }
        if (construto instanceof AcessoMetodo) {
            const tipoObjeto = this.resolverTipoConstruto(construto.objeto);
            switch (construto.nomeMetodo) {
                case 'adicionar':
                    if (this.tipoEhVetor(tipoObjeto)) return tipoObjeto;
                    break;
                case 'chaves':
                    return this.mapearTipoColecaoChaves(tipoObjeto);
                case 'valores':
                    return this.mapearTipoColecaoValores(tipoObjeto);
            }

            throw new ErroCompilador(`Método '${construto.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
        }
        if (construto instanceof AcessoMetodoOuPropriedade) {
            const tipoObjeto = this.resolverTipoConstruto(construto.objeto);

            const classe = this.classes.get(tipoObjeto);
            if (classe) {
                const localizacaoCampo = this.localizarCampoClasse(classe.nome, construto.simbolo.lexema);
                if (!localizacaoCampo) {
                    throw new ErroCompilador(`Propriedade '${construto.simbolo.lexema}' não definida na classe '${classe.nome}'.`);
                }

                return localizacaoCampo.campo.tipoDelegua;
            }

            if (
                construto.simbolo.lexema === 'tamanho' &&
                (this.tipoEhTexto(tipoObjeto) || this.tipoEhVetor(tipoObjeto) || this.tipoEhDicionario(tipoObjeto) || this.tipoEhTupla(tipoObjeto))
            ) {
                return 'inteiro';
            }

            if (construto.simbolo.lexema === 'chaves') {
                return this.mapearTipoColecaoChaves(tipoObjeto);
            }

            if (construto.simbolo.lexema === 'valores') {
                return this.mapearTipoColecaoValores(tipoObjeto);
            }

            throw new ErroCompilador(`Acesso '${construto.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
        }
        if (construto instanceof DefinirValor) {
            const tipoObjeto = this.resolverTipoConstruto(construto.objeto);
            const classe = this.classes.get(tipoObjeto);
            if (!classe) {
                throw new ErroCompilador('Definição de propriedade suportada apenas para instâncias de classe nesta fase do compilador.');
            }

            const tipoValor = this.resolverTipoConstruto(construto.valor);
            const nomeCampo = construto.nome.lexema;
            const campoExistente = this.localizarCampoClasse(classe.nome, nomeCampo)?.campo;
            if (campoExistente) {
                const compativel =
                    tipoValor === campoExistente.tipoDelegua ||
                    (campoExistente.tipoDelegua === 'numero' && tipoValor === 'inteiro');
                if (!compativel) {
                    throw new ErroCompilador(
                        `Propriedade '${classe.nome}.${nomeCampo}' é '${campoExistente.tipoDelegua}', mas recebeu '${tipoValor}'.`
                    );
                }

                return campoExistente.tipoDelegua;
            }

            classe.campos.set(nomeCampo, {
                nome: nomeCampo,
                tipoDelegua: tipoValor,
                tipoCil: this.mapearTipoCil(tipoValor),
            });
            return tipoValor;
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

    async visitarExpressaoTuplaN(expressao: TuplaN): Promise<string> {
        const tipoTupla = this.resolverTipoConstruto(expressao);
        const tipoElemento = this.obterTipoElementoTupla(tipoTupla);
        const tipoElementoCil = this.mapearTipoElementoCil(tipoElemento);

        this.instrucoes.push(`ldc.i4 ${expressao.elementos.length}`);
        this.instrucoes.push(`newarr ${tipoElementoCil}`);

        for (let indice = 0; indice < expressao.elementos.length; indice++) {
            const elemento = expressao.elementos[indice];
            const tipoAtual = this.resolverTipoConstruto(elemento);
            this.instrucoes.push('dup');
            this.instrucoes.push(`ldc.i4 ${indice}`);
            await elemento.aceitar(this as any);
            if (tipoElemento === 'numero' && tipoAtual === 'inteiro') {
                this.instrucoes.push('conv.r8');
            }

            this.instrucoes.push(
                tipoElementoCil === 'int32' || tipoElementoCil === 'bool'
                    ? `stelem.i4`
                    : tipoElementoCil === 'float64'
                      ? `stelem.r8`
                      : tipoElementoCil === 'string'
                        ? `stelem.ref`
                        : `stelem ${tipoElementoCil}`
            );
        }

        return tipoTupla;
    }

    async visitarExpressaoDicionario(expressao: Dicionario): Promise<string> {
        const tipoDicionario = this.resolverTipoConstruto(expressao);
        const tipos = this.obterTiposDicionario(tipoDicionario);
        const tipoDicionarioCil = this.mapearTipoDicionarioCil(tipos.chave, tipos.valor);
        const tipoChaveCil = this.mapearTipoElementoCil(tipos.chave);
        const tipoValorCil = this.mapearTipoElementoCil(tipos.valor);

        this.instrucoes.push(`newobj instance void ${tipoDicionarioCil}::.ctor()`);

        for (let indice = 0; indice < expressao.chaves.length; indice++) {
            this.instrucoes.push('dup');
            await this.emitirConstrutoParaTipoEsperado(expressao.chaves[indice], tipos.chave);

            const valor = expressao.valores[indice];
            await this.emitirConstrutoParaTipoEsperado(valor, tipos.valor);

            this.instrucoes.push(`callvirt instance void ${tipoDicionarioCil}::Add(${tipoChaveCil}, ${tipoValorCil})`);
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

        if (this.tipoEhTupla(tipoEntidade)) {
            const tipoElemento = this.obterTipoElementoTupla(tipoEntidade);
            const tipoElementoCil = this.mapearTipoElementoCil(tipoElemento);
            const tipoIndice = this.resolverTipoConstruto(expressao.indice);
            if (!this.tipoEhNumerico(tipoIndice)) {
                throw new ErroCompilador('Índice de tupla deve ser numérico.');
            }

            await expressao.entidadeChamada.aceitar(this as any);
            await expressao.indice.aceitar(this as any);
            if (tipoIndice === 'numero') {
                throw new ErroCompilador('Índice de tupla deve ser inteiro nesta fase do compilador.');
            }

            this.instrucoes.push(
                tipoElementoCil === 'int32' || tipoElementoCil === 'bool'
                    ? 'ldelem.i4'
                    : tipoElementoCil === 'float64'
                      ? 'ldelem.r8'
                      : tipoElementoCil === 'string'
                        ? 'ldelem.ref'
                        : `ldelem ${tipoElementoCil}`
            );
            return tipoElemento;
        }

        if (this.tipoEhDicionario(tipoEntidade)) {
            const tipos = this.obterTiposDicionario(tipoEntidade);
            const tipoIndice = this.resolverTipoConstruto(expressao.indice);
            const indiceCompativel = tipoIndice === tipos.chave || (tipos.chave === 'numero' && tipoIndice === 'inteiro');
            if (!indiceCompativel) {
                throw new ErroCompilador(`Índice de dicionário deve ser '${tipos.chave}'.`);
            }

            await expressao.entidadeChamada.aceitar(this as any);
            await this.emitirConstrutoParaTipoEsperado(expressao.indice, tipos.chave);
            this.instrucoes.push(
                `callvirt instance ${this.mapearTipoElementoCil(tipos.valor)} ${this.mapearTipoDicionarioCil(tipos.chave, tipos.valor)}::get_Item(${this.mapearTipoElementoCil(tipos.chave)})`
            );
            return tipos.valor;
        }

        throw new ErroCompilador('Acesso por índice suportado apenas para vetores, tuplas e dicionários nesta fase do compilador.');
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

        if (this.tipoEhTupla(tipoObjeto)) {
            const tipoElemento = this.obterTipoElementoTupla(tipoObjeto);
            const tipoIndice = this.resolverTipoConstruto(expressao.indice);
            if (!this.tipoEhNumerico(tipoIndice) || tipoIndice === 'numero') {
                throw new ErroCompilador('Índice de tupla deve ser inteiro nesta fase do compilador.');
            }

            const tipoValor = this.resolverTipoConstruto(expressao.valor);
            const tipoCompativel =
                tipoValor === tipoElemento || (tipoElemento === 'numero' && tipoValor === 'inteiro');
            if (!tipoCompativel) {
                throw new ErroCompilador(
                    `Não pode atribuir valor do tipo '${tipoValor}' a tupla de elementos '${tipoElemento}'.`
                );
            }

            const tipoElementoCil = this.mapearTipoElementoCil(tipoElemento);

            await expressao.objeto.aceitar(this as any);
            await expressao.indice.aceitar(this as any);
            await expressao.valor.aceitar(this as any);
            if (tipoElemento === 'numero' && tipoValor === 'inteiro') {
                this.instrucoes.push('conv.r8');
            }

            this.instrucoes.push(
                tipoElementoCil === 'int32' || tipoElementoCil === 'bool'
                    ? 'stelem.i4'
                    : tipoElementoCil === 'float64'
                      ? 'stelem.r8'
                      : tipoElementoCil === 'string'
                        ? 'stelem.ref'
                        : `stelem ${tipoElementoCil}`
            );
            return;
        }

        if (this.tipoEhDicionario(tipoObjeto)) {
            const tipos = this.obterTiposDicionario(tipoObjeto);
            const tipoIndice = this.resolverTipoConstruto(expressao.indice);
            const indiceCompativel = tipoIndice === tipos.chave || (tipos.chave === 'numero' && tipoIndice === 'inteiro');
            if (!indiceCompativel) {
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
            await this.emitirConstrutoParaTipoEsperado(expressao.indice, tipos.chave);
            await this.emitirConstrutoParaTipoEsperado(expressao.valor, tipos.valor);

            this.instrucoes.push(`callvirt instance void ${tipoDicionarioCil}::set_Item(${tipoChaveCil}, ${tipoValorCil})`);
            return;
        }

        throw new ErroCompilador('Atribuição por índice suportada apenas para vetores, tuplas e dicionários nesta fase do compilador.');
    }

    async visitarExpressaoDeChamada(expressao: Chamada): Promise<string> {
        if (expressao.entidadeChamada instanceof AcessoMetodo) {
            const tipoObjeto = this.resolverTipoConstruto(expressao.entidadeChamada.objeto);
            switch (expressao.entidadeChamada.nomeMetodo) {
                case 'concatenar':
                    if (!this.tipoEhTexto(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }
                    if (expressao.argumentos.length < 1) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' espera ao menos 1 argumento.`);
                    }
                    if (expressao.argumentos.some((argumento: any) => this.resolverTipoConstruto(argumento) !== 'texto')) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' requer argumentos de texto.`);
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    for (const argumento of expressao.argumentos) {
                        await this.emitirConstrutoParaTipoEsperado(argumento, 'texto');
                        this.instrucoes.push('call string [mscorlib]System.String::Concat(string, string)');
                    }
                    return 'texto';
                case 'fatiar':
                    if (!this.tipoEhTexto(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }
                    if (expressao.argumentos.length < 1 || expressao.argumentos.length > 2) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' espera 1 ou 2 argumentos.`);
                    }
                    if (!this.tipoEhNumerico(this.resolverTipoConstruto(expressao.argumentos[0])) || this.resolverTipoConstruto(expressao.argumentos[0]) === 'numero') {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' requer índice inicial inteiro.`);
                    }
                    if (expressao.argumentos[1] && (!this.tipoEhNumerico(this.resolverTipoConstruto(expressao.argumentos[1])) || this.resolverTipoConstruto(expressao.argumentos[1]) === 'numero')) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' requer índice final inteiro.`);
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    await expressao.argumentos[0].aceitar(this as any);
                    if (expressao.argumentos[1]) {
                        const localInicio = this.reservarLocalTemporario('inteiro');
                        this.instrucoes.push('dup');
                        this.emitirArmazenamentoVariavel(localInicio);
                        await expressao.argumentos[1].aceitar(this as any);
                        this.emitirCarregamentoVariavel(localInicio);
                        this.instrucoes.push('sub');
                        this.instrucoes.push('callvirt instance string [mscorlib]System.String::Substring(int32, int32)');
                    } else {
                        this.instrucoes.push('callvirt instance string [mscorlib]System.String::Substring(int32)');
                    }
                    return 'texto';
                case 'subtexto':
                    if (!this.tipoEhTexto(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }
                    if (expressao.argumentos.length !== 2) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' espera 2 argumentos.`);
                    }
                    if (
                        !this.tipoEhNumerico(this.resolverTipoConstruto(expressao.argumentos[0])) ||
                        this.resolverTipoConstruto(expressao.argumentos[0]) === 'numero' ||
                        !this.tipoEhNumerico(this.resolverTipoConstruto(expressao.argumentos[1])) ||
                        this.resolverTipoConstruto(expressao.argumentos[1]) === 'numero'
                    ) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' requer índices inteiros.`);
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    await expressao.argumentos[0].aceitar(this as any);
                    const localInicioSubtexto = this.reservarLocalTemporario('inteiro');
                    this.instrucoes.push('dup');
                    this.emitirArmazenamentoVariavel(localInicioSubtexto);
                    await expressao.argumentos[1].aceitar(this as any);
                    this.emitirCarregamentoVariavel(localInicioSubtexto);
                    this.instrucoes.push('sub');
                    this.instrucoes.push('callvirt instance string [mscorlib]System.String::Substring(int32, int32)');
                    return 'texto';
                case 'inverter':
                    if (!this.tipoEhTexto(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }
                    if (expressao.argumentos.length !== 0) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não aceita argumentos nesta fase do compilador.`);
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    this.instrucoes.push('callvirt instance char[] [mscorlib]System.String::ToCharArray()');
                    this.instrucoes.push('dup');
                    this.instrucoes.push('call void [mscorlib]System.Array::Reverse(class [mscorlib]System.Array)');
                    this.instrucoes.push('newobj instance void [mscorlib]System.String::.ctor(char[])');
                    return 'texto';
                case 'aparar':
                    if (!this.tipoEhTexto(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }
                    if (expressao.argumentos.length !== 0) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não aceita argumentos nesta fase do compilador.`);
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    this.instrucoes.push('callvirt instance string [mscorlib]System.String::Trim()');
                    return 'texto';
                case 'apararInicio':
                    if (!this.tipoEhTexto(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }
                    if (expressao.argumentos.length !== 0) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não aceita argumentos nesta fase do compilador.`);
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    this.instrucoes.push('callvirt instance string [mscorlib]System.String::TrimStart()');
                    return 'texto';
                case 'apararFim':
                    if (!this.tipoEhTexto(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }
                    if (expressao.argumentos.length !== 0) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não aceita argumentos nesta fase do compilador.`);
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    this.instrucoes.push('callvirt instance string [mscorlib]System.String::TrimEnd()');
                    return 'texto';
                case 'contem':
                case 'inclui':
                case 'tudoMaiusculo':
                case 'tudoMaiúsculo':
                case 'tudoMinusculo':
                case 'tudoMinúsculo':
                    if (!this.tipoEhTexto(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }
                    if (
                        (expressao.entidadeChamada.nomeMetodo === 'contem' || expressao.entidadeChamada.nomeMetodo === 'inclui') &&
                        expressao.argumentos.length !== 1
                    ) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' espera 1 argumento.`);
                    }
                    if (
                        (expressao.entidadeChamada.nomeMetodo === 'contem' || expressao.entidadeChamada.nomeMetodo === 'inclui') &&
                        this.resolverTipoConstruto(expressao.argumentos[0]) !== 'texto'
                    ) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' requer argumento de texto.`);
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    if (expressao.entidadeChamada.nomeMetodo === 'contem' || expressao.entidadeChamada.nomeMetodo === 'inclui') {
                        await this.emitirConstrutoParaTipoEsperado(expressao.argumentos[0], 'texto');
                        this.instrucoes.push('callvirt instance bool [mscorlib]System.String::Contains(string)');
                    } else {
                        this.instrucoes.push('dup');
                        if (expressao.entidadeChamada.nomeMetodo === 'tudoMaiusculo' || expressao.entidadeChamada.nomeMetodo === 'tudoMaiúsculo') {
                            this.instrucoes.push('callvirt instance string [mscorlib]System.String::ToUpper()');
                        } else {
                            this.instrucoes.push('callvirt instance string [mscorlib]System.String::ToLower()');
                        }
                        this.instrucoes.push('call bool [mscorlib]System.String::op_Equality(string, string)');
                    }
                    return 'logico';
                case 'encontrar':
                    if (!this.tipoEhTexto(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }
                    if (expressao.argumentos.length < 1 || expressao.argumentos.length > 2) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' espera 1 ou 2 argumentos.`);
                    }
                    if (this.resolverTipoConstruto(expressao.argumentos[0]) !== 'texto') {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' requer subtexto de tipo texto.`);
                    }
                    if (expressao.argumentos[1]) {
                        const tipoIndiceInicio = this.resolverTipoConstruto(expressao.argumentos[1]);
                        if (!this.tipoEhNumerico(tipoIndiceInicio) || tipoIndiceInicio === 'numero') {
                            throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' requer índice inicial inteiro.`);
                        }
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    await this.emitirConstrutoParaTipoEsperado(expressao.argumentos[0], 'texto');
                    if (expressao.argumentos[1]) {
                        await expressao.argumentos[1].aceitar(this as any);
                        this.instrucoes.push('callvirt instance int32 [mscorlib]System.String::IndexOf(string, int32)');
                    } else {
                        this.instrucoes.push('callvirt instance int32 [mscorlib]System.String::IndexOf(string)');
                    }
                    return 'inteiro';
                case 'iniciaCom':
                    if (!this.tipoEhTexto(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }
                    if (expressao.argumentos.length !== 1) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' espera 1 argumento.`);
                    }
                    if (this.resolverTipoConstruto(expressao.argumentos[0]) !== 'texto') {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' requer argumento de texto.`);
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    await this.emitirConstrutoParaTipoEsperado(expressao.argumentos[0], 'texto');
                    this.instrucoes.push('callvirt instance bool [mscorlib]System.String::StartsWith(string)');
                    return 'logico';
                case 'terminaCom':
                    if (!this.tipoEhTexto(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }
                    if (expressao.argumentos.length !== 1) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' espera 1 argumento.`);
                    }
                    if (this.resolverTipoConstruto(expressao.argumentos[0]) !== 'texto') {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' requer argumento de texto.`);
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    await this.emitirConstrutoParaTipoEsperado(expressao.argumentos[0], 'texto');
                    this.instrucoes.push('callvirt instance bool [mscorlib]System.String::EndsWith(string)');
                    return 'logico';
                case 'maiusculo':
                case 'maiúsculo':
                    if (!this.tipoEhTexto(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }
                    if (expressao.argumentos.length !== 0) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não aceita argumentos nesta fase do compilador.`);
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    this.instrucoes.push('callvirt instance string [mscorlib]System.String::ToUpper()');
                    return 'texto';
                case 'minusculo':
                case 'minúsculo':
                    if (!this.tipoEhTexto(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }
                    if (expressao.argumentos.length !== 0) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não aceita argumentos nesta fase do compilador.`);
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    this.instrucoes.push('callvirt instance string [mscorlib]System.String::ToLower()');
                    return 'texto';
                case 'substituir':
                    if (!this.tipoEhTexto(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }
                    if (expressao.argumentos.length !== 2) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' espera 2 argumento(s).`);
                    }

                    if (this.resolverTipoConstruto(expressao.argumentos[0]) !== 'texto' || this.resolverTipoConstruto(expressao.argumentos[1]) !== 'texto') {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' requer argumentos de texto.`);
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    await this.emitirConstrutoParaTipoEsperado(expressao.argumentos[0], 'texto');
                    await this.emitirConstrutoParaTipoEsperado(expressao.argumentos[1], 'texto');
                    this.instrucoes.push('callvirt instance string [mscorlib]System.String::Replace(string, string)');
                    return 'texto';
                case 'divida':
                case 'dividir':
                    if (!this.tipoEhTexto(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }
                    if (expressao.argumentos.length < 1 || expressao.argumentos.length > 2) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' espera 1 ou 2 argumentos.`);
                    }

                    if (this.resolverTipoConstruto(expressao.argumentos[0]) !== 'texto') {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' requer argumento de texto.`);
                    }

                    if (expressao.argumentos[1]) {
                        const tipoLimite = this.resolverTipoConstruto(expressao.argumentos[1]);
                        if (!this.tipoEhNumerico(tipoLimite) || tipoLimite === 'numero') {
                            throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' requer limite inteiro quando informado.`);
                        }
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    await this.emitirConstrutoParaTipoEsperado(expressao.argumentos[0], 'texto');
                    this.instrucoes.push('callvirt instance char[] [mscorlib]System.String::ToCharArray()');
                    if (expressao.argumentos[1]) {
                        await expressao.argumentos[1].aceitar(this as any);
                        this.instrucoes.push('callvirt instance string[] [mscorlib]System.String::Split(char[], int32)');
                    } else {
                        this.instrucoes.push('callvirt instance string[] [mscorlib]System.String::Split(char[])');
                    }
                    return 'texto()';
                case 'particao':
                case 'partição':
                    if (!this.tipoEhTexto(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }
                    if (expressao.argumentos.length !== 1) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' espera 1 argumento.`);
                    }
                    if (this.resolverTipoConstruto(expressao.argumentos[0]) !== 'texto') {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' requer argumento de texto.`);
                    }

                    const localTextoParticao = this.reservarLocalTemporario('texto');
                    const localSeparadorParticao = this.reservarLocalTemporario('texto');
                    const localIndiceParticao = this.reservarLocalTemporario('inteiro');
                    const localResultadoParticao = this.reservarLocalTemporario('texto()');
                    const rotuloSeparadorEncontrado = this.gerarRotulo();
                    const rotuloFimParticao = this.gerarRotulo();

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    this.emitirArmazenamentoVariavel(localTextoParticao);
                    await this.emitirConstrutoParaTipoEsperado(expressao.argumentos[0], 'texto');
                    this.emitirArmazenamentoVariavel(localSeparadorParticao);

                    this.emitirCarregamentoVariavel(localTextoParticao);
                    this.emitirCarregamentoVariavel(localSeparadorParticao);
                    this.instrucoes.push('callvirt instance int32 [mscorlib]System.String::IndexOf(string)');
                    this.emitirArmazenamentoVariavel(localIndiceParticao);

                    this.instrucoes.push('ldc.i4.3');
                    this.instrucoes.push('newarr string');
                    this.emitirArmazenamentoVariavel(localResultadoParticao);

                    this.emitirCarregamentoVariavel(localIndiceParticao);
                    this.instrucoes.push('ldc.i4.m1');
                    this.instrucoes.push('ceq');
                    this.instrucoes.push(`brfalse ${rotuloSeparadorEncontrado}`);

                    this.emitirCarregamentoVariavel(localResultadoParticao);
                    this.instrucoes.push('ldc.i4.0');
                    this.emitirCarregamentoVariavel(localTextoParticao);
                    this.instrucoes.push('stelem.ref');
                    this.emitirCarregamentoVariavel(localResultadoParticao);
                    this.instrucoes.push('ldc.i4.1');
                    this.instrucoes.push('ldstr ""');
                    this.instrucoes.push('stelem.ref');
                    this.emitirCarregamentoVariavel(localResultadoParticao);
                    this.instrucoes.push('ldc.i4.2');
                    this.instrucoes.push('ldstr ""');
                    this.instrucoes.push('stelem.ref');
                    this.instrucoes.push(`br ${rotuloFimParticao}`);

                    this.emitirRotulo(rotuloSeparadorEncontrado);
                    this.emitirCarregamentoVariavel(localResultadoParticao);
                    this.instrucoes.push('ldc.i4.0');
                    this.emitirCarregamentoVariavel(localTextoParticao);
                    this.instrucoes.push('ldc.i4.0');
                    this.emitirCarregamentoVariavel(localIndiceParticao);
                    this.instrucoes.push('callvirt instance string [mscorlib]System.String::Substring(int32, int32)');
                    this.instrucoes.push('stelem.ref');
                    this.emitirCarregamentoVariavel(localResultadoParticao);
                    this.instrucoes.push('ldc.i4.1');
                    this.emitirCarregamentoVariavel(localSeparadorParticao);
                    this.instrucoes.push('stelem.ref');
                    this.emitirCarregamentoVariavel(localResultadoParticao);
                    this.instrucoes.push('ldc.i4.2');
                    this.emitirCarregamentoVariavel(localTextoParticao);
                    this.emitirCarregamentoVariavel(localIndiceParticao);
                    this.emitirCarregamentoVariavel(localSeparadorParticao);
                    this.instrucoes.push('callvirt instance int32 [mscorlib]System.String::get_Length()');
                    this.instrucoes.push('add');
                    this.instrucoes.push('callvirt instance string [mscorlib]System.String::Substring(int32)');
                    this.instrucoes.push('stelem.ref');

                    this.emitirRotulo(rotuloFimParticao);
                    this.emitirCarregamentoVariavel(localResultadoParticao);
                    return 'texto()';
                case 'tamanho':
                    if (expressao.argumentos.length !== 0) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não aceita argumentos nesta fase do compilador.`);
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    this.emitirCarregamentoTamanhoColecao(tipoObjeto);
                    return 'inteiro';
                case 'adicionar':
                    if (!this.tipoEhVetor(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }
                    if (expressao.argumentos.length !== 1) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' espera 1 argumento.`);
                    }

                    const tipoElemento = this.obterTipoElementoVetor(tipoObjeto);
                    const tipoArgumento = this.resolverTipoConstruto(expressao.argumentos[0]);
                    const tipoCompativel =
                        tipoArgumento === tipoElemento || (tipoElemento === 'numero' && tipoArgumento === 'inteiro');
                    if (!tipoCompativel) {
                        throw new ErroCompilador(`Método 'adicionar' requer '${tipoElemento}', mas recebeu '${tipoArgumento}'.`);
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    this.instrucoes.push('dup');
                    await this.emitirConstrutoParaTipoEsperado(expressao.argumentos[0], tipoElemento);
                    this.instrucoes.push(`callvirt instance void ${this.mapearTipoVetorCil(tipoElemento)}::Add(${this.mapearTipoElementoCil(tipoElemento)})`);
                    return tipoObjeto;
                case 'chaves':
                    if (expressao.argumentos.length !== 0) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não aceita argumentos nesta fase do compilador.`);
                    }
                    if (!this.tipoEhDicionario(tipoObjeto)) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    this.emitirConstrucaoListaDeChavesDicionario(tipoObjeto);
                    return this.mapearTipoColecaoChaves(tipoObjeto);
                case 'valores':
                    if (expressao.argumentos.length !== 0) {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não aceita argumentos nesta fase do compilador.`);
                    }

                    await expressao.entidadeChamada.objeto.aceitar(this as any);
                    if (this.tipoEhVetor(tipoObjeto)) {
                        return tipoObjeto;
                    }
                    if (this.tipoEhDicionario(tipoObjeto)) {
                        this.emitirConstrucaoListaDeValoresDicionario(tipoObjeto);
                        return this.mapearTipoColecaoValores(tipoObjeto);
                    }
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
            }

            throw new ErroCompilador(`Método '${expressao.entidadeChamada.nomeMetodo}' não implementado para '${tipoObjeto}'.`);
        }

        if (expressao.entidadeChamada instanceof AcessoMetodoOuPropriedade) {
            const tipoObjeto = this.resolverTipoConstruto(expressao.entidadeChamada.objeto);
            const classe = this.classes.get(tipoObjeto);
            if (classe) {
                const localizacaoMetodo = this.localizarMetodoClasse(classe.nome, expressao.entidadeChamada.simbolo.lexema);
                const metodoClasse = localizacaoMetodo?.metodo;
                if (!metodoClasse || metodoClasse.eConstrutor) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não existe na classe '${classe.nome}'.`);
                }

                if (expressao.argumentos.length !== metodoClasse.parametros.length) {
                    throw new ErroCompilador(
                        `Método '${classe.nome}.${metodoClasse.nome}' espera ${metodoClasse.parametros.length} argumento(s), mas recebeu ${expressao.argumentos.length}.`
                    );
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                for (let indice = 0; indice < expressao.argumentos.length; indice++) {
                    const argumento = expressao.argumentos[indice];
                    const parametro = metodoClasse.parametros[indice];
                    const tipoArgumento = this.resolverTipoConstruto(argumento);
                    const compativel =
                        tipoArgumento === parametro.tipoDelegua ||
                        (parametro.tipoDelegua === 'numero' && tipoArgumento === 'inteiro');
                    if (!compativel) {
                        throw new ErroCompilador(
                            `Argumento ${indice + 1} do método '${classe.nome}.${metodoClasse.nome}' deve ser '${parametro.tipoDelegua}', mas recebeu '${tipoArgumento}'.`
                        );
                    }

                    await argumento.aceitar(this as any);
                    if (parametro.tipoDelegua === 'numero' && tipoArgumento === 'inteiro') {
                        this.instrucoes.push('conv.r8');
                    }
                }

                this.instrucoes.push(
                    `callvirt instance ${metodoClasse.tipoRetornoCil} class ${localizacaoMetodo?.classeDona.nome || classe.nome}::${metodoClasse.nomeCil}(${metodoClasse.parametros
                        .map((parametro) => parametro.tipoCil)
                        .join(', ')})`
                );
                return metodoClasse.tipoRetornoDelegua;
            }

            if (expressao.entidadeChamada.simbolo.lexema === 'maiusculo' || expressao.entidadeChamada.simbolo.lexema === 'maiúsculo') {
                if (!this.tipoEhTexto(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
                if (expressao.argumentos.length !== 0) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não aceita argumentos nesta fase do compilador.`);
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                this.instrucoes.push('callvirt instance string [mscorlib]System.String::ToUpper()');
                return 'texto';
            }

            if (expressao.entidadeChamada.simbolo.lexema === 'concatenar') {
                if (!this.tipoEhTexto(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
                if (expressao.argumentos.length < 1) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' espera ao menos 1 argumento.`);
                }
                if (expressao.argumentos.some((argumento: any) => this.resolverTipoConstruto(argumento) !== 'texto')) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' requer argumentos de texto.`);
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                for (const argumento of expressao.argumentos) {
                    await this.emitirConstrutoParaTipoEsperado(argumento, 'texto');
                    this.instrucoes.push('call string [mscorlib]System.String::Concat(string, string)');
                }
                return 'texto';
            }

            if (expressao.entidadeChamada.simbolo.lexema === 'fatiar') {
                if (!this.tipoEhTexto(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
                if (expressao.argumentos.length < 1 || expressao.argumentos.length > 2) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' espera 1 ou 2 argumentos.`);
                }
                if (!this.tipoEhNumerico(this.resolverTipoConstruto(expressao.argumentos[0])) || this.resolverTipoConstruto(expressao.argumentos[0]) === 'numero') {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' requer índice inicial inteiro.`);
                }
                if (expressao.argumentos[1] && (!this.tipoEhNumerico(this.resolverTipoConstruto(expressao.argumentos[1])) || this.resolverTipoConstruto(expressao.argumentos[1]) === 'numero')) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' requer índice final inteiro.`);
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                await expressao.argumentos[0].aceitar(this as any);
                if (expressao.argumentos[1]) {
                    const localInicio = this.reservarLocalTemporario('inteiro');
                    this.instrucoes.push('dup');
                    this.emitirArmazenamentoVariavel(localInicio);
                    await expressao.argumentos[1].aceitar(this as any);
                    this.emitirCarregamentoVariavel(localInicio);
                    this.instrucoes.push('sub');
                    this.instrucoes.push('callvirt instance string [mscorlib]System.String::Substring(int32, int32)');
                } else {
                    this.instrucoes.push('callvirt instance string [mscorlib]System.String::Substring(int32)');
                }
                return 'texto';
            }

            if (expressao.entidadeChamada.simbolo.lexema === 'subtexto') {
                if (!this.tipoEhTexto(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
                if (expressao.argumentos.length !== 2) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' espera 2 argumentos.`);
                }
                if (
                    !this.tipoEhNumerico(this.resolverTipoConstruto(expressao.argumentos[0])) ||
                    this.resolverTipoConstruto(expressao.argumentos[0]) === 'numero' ||
                    !this.tipoEhNumerico(this.resolverTipoConstruto(expressao.argumentos[1])) ||
                    this.resolverTipoConstruto(expressao.argumentos[1]) === 'numero'
                ) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' requer índices inteiros.`);
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                await expressao.argumentos[0].aceitar(this as any);
                const localInicioSubtexto = this.reservarLocalTemporario('inteiro');
                this.instrucoes.push('dup');
                this.emitirArmazenamentoVariavel(localInicioSubtexto);
                await expressao.argumentos[1].aceitar(this as any);
                this.emitirCarregamentoVariavel(localInicioSubtexto);
                this.instrucoes.push('sub');
                this.instrucoes.push('callvirt instance string [mscorlib]System.String::Substring(int32, int32)');
                return 'texto';
            }

            if (expressao.entidadeChamada.simbolo.lexema === 'inverter') {
                if (!this.tipoEhTexto(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
                if (expressao.argumentos.length !== 0) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não aceita argumentos nesta fase do compilador.`);
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                this.instrucoes.push('callvirt instance char[] [mscorlib]System.String::ToCharArray()');
                this.instrucoes.push('dup');
                this.instrucoes.push('call void [mscorlib]System.Array::Reverse(class [mscorlib]System.Array)');
                this.instrucoes.push('newobj instance void [mscorlib]System.String::.ctor(char[])');
                return 'texto';
            }

            if (expressao.entidadeChamada.simbolo.lexema === 'aparar') {
                if (!this.tipoEhTexto(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
                if (expressao.argumentos.length !== 0) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não aceita argumentos nesta fase do compilador.`);
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                this.instrucoes.push('callvirt instance string [mscorlib]System.String::Trim()');
                return 'texto';
            }

            if (expressao.entidadeChamada.simbolo.lexema === 'apararInício') {
                if (!this.tipoEhTexto(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
                if (expressao.argumentos.length !== 0) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não aceita argumentos nesta fase do compilador.`);
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                this.instrucoes.push('callvirt instance string [mscorlib]System.String::TrimStart()');
                return 'texto';
            }

            if (expressao.entidadeChamada.simbolo.lexema === 'apararInicio') {
                if (!this.tipoEhTexto(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
                if (expressao.argumentos.length !== 0) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não aceita argumentos nesta fase do compilador.`);
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                this.instrucoes.push('callvirt instance string [mscorlib]System.String::TrimStart()');
                return 'texto';
            }

            if (expressao.entidadeChamada.simbolo.lexema === 'apararFim') {
                if (!this.tipoEhTexto(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
                if (expressao.argumentos.length !== 0) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não aceita argumentos nesta fase do compilador.`);
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                this.instrucoes.push('callvirt instance string [mscorlib]System.String::TrimEnd()');
                return 'texto';
            }

            if (
                expressao.entidadeChamada.simbolo.lexema === 'contem' ||
                expressao.entidadeChamada.simbolo.lexema === 'inclui' ||
                expressao.entidadeChamada.simbolo.lexema === 'tudoMaiusculo' ||
                expressao.entidadeChamada.simbolo.lexema === 'tudoMaiúsculo' ||
                expressao.entidadeChamada.simbolo.lexema === 'tudoMinusculo' ||
                expressao.entidadeChamada.simbolo.lexema === 'tudoMinúsculo'
            ) {
                if (!this.tipoEhTexto(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
                if (
                    (expressao.entidadeChamada.simbolo.lexema === 'contem' || expressao.entidadeChamada.simbolo.lexema === 'inclui') &&
                    expressao.argumentos.length !== 1
                ) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' espera 1 argumento.`);
                }
                if (
                    (expressao.entidadeChamada.simbolo.lexema === 'contem' || expressao.entidadeChamada.simbolo.lexema === 'inclui') &&
                    this.resolverTipoConstruto(expressao.argumentos[0]) !== 'texto'
                ) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' requer argumento de texto.`);
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                if (expressao.entidadeChamada.simbolo.lexema === 'contem' || expressao.entidadeChamada.simbolo.lexema === 'inclui') {
                    await this.emitirConstrutoParaTipoEsperado(expressao.argumentos[0], 'texto');
                    this.instrucoes.push('callvirt instance bool [mscorlib]System.String::Contains(string)');
                } else {
                    this.instrucoes.push('dup');
                    if (expressao.entidadeChamada.simbolo.lexema === 'tudoMaiusculo' || expressao.entidadeChamada.simbolo.lexema === 'tudoMaiúsculo') {
                        this.instrucoes.push('callvirt instance string [mscorlib]System.String::ToUpper()');
                    } else {
                        this.instrucoes.push('callvirt instance string [mscorlib]System.String::ToLower()');
                    }
                    this.instrucoes.push('call bool [mscorlib]System.String::op_Equality(string, string)');
                }
                return 'logico';
            }
            if (expressao.entidadeChamada.simbolo.lexema === 'particao' || expressao.entidadeChamada.simbolo.lexema === 'partição') {
                if (!this.tipoEhTexto(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
                if (expressao.argumentos.length !== 1) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' espera 1 argumento.`);
                }
                if (this.resolverTipoConstruto(expressao.argumentos[0]) !== 'texto') {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' requer argumento de texto.`);
                }

                const localTextoParticao = this.reservarLocalTemporario('texto');
                const localSeparadorParticao = this.reservarLocalTemporario('texto');
                const localIndiceParticao = this.reservarLocalTemporario('inteiro');
                const localResultadoParticao = this.reservarLocalTemporario('texto()');
                const rotuloSeparadorEncontrado = this.gerarRotulo();
                const rotuloFimParticao = this.gerarRotulo();

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                this.emitirArmazenamentoVariavel(localTextoParticao);
                await this.emitirConstrutoParaTipoEsperado(expressao.argumentos[0], 'texto');
                this.emitirArmazenamentoVariavel(localSeparadorParticao);

                this.emitirCarregamentoVariavel(localTextoParticao);
                this.emitirCarregamentoVariavel(localSeparadorParticao);
                this.instrucoes.push('callvirt instance int32 [mscorlib]System.String::IndexOf(string)');
                this.emitirArmazenamentoVariavel(localIndiceParticao);

                this.instrucoes.push('ldc.i4.3');
                this.instrucoes.push('newarr string');
                this.emitirArmazenamentoVariavel(localResultadoParticao);

                this.emitirCarregamentoVariavel(localIndiceParticao);
                this.instrucoes.push('ldc.i4.m1');
                this.instrucoes.push('ceq');
                this.instrucoes.push(`brfalse ${rotuloSeparadorEncontrado}`);

                this.emitirCarregamentoVariavel(localResultadoParticao);
                this.instrucoes.push('ldc.i4.0');
                this.emitirCarregamentoVariavel(localTextoParticao);
                this.instrucoes.push('stelem.ref');
                this.emitirCarregamentoVariavel(localResultadoParticao);
                this.instrucoes.push('ldc.i4.1');
                this.instrucoes.push('ldstr ""');
                this.instrucoes.push('stelem.ref');
                this.emitirCarregamentoVariavel(localResultadoParticao);
                this.instrucoes.push('ldc.i4.2');
                this.instrucoes.push('ldstr ""');
                this.instrucoes.push('stelem.ref');
                this.instrucoes.push(`br ${rotuloFimParticao}`);

                this.emitirRotulo(rotuloSeparadorEncontrado);
                this.emitirCarregamentoVariavel(localResultadoParticao);
                this.instrucoes.push('ldc.i4.0');
                this.emitirCarregamentoVariavel(localTextoParticao);
                this.instrucoes.push('ldc.i4.0');
                this.emitirCarregamentoVariavel(localIndiceParticao);
                this.instrucoes.push('callvirt instance string [mscorlib]System.String::Substring(int32, int32)');
                this.instrucoes.push('stelem.ref');
                this.emitirCarregamentoVariavel(localResultadoParticao);
                this.instrucoes.push('ldc.i4.1');
                this.emitirCarregamentoVariavel(localSeparadorParticao);
                this.instrucoes.push('stelem.ref');
                this.emitirCarregamentoVariavel(localResultadoParticao);
                this.instrucoes.push('ldc.i4.2');
                this.emitirCarregamentoVariavel(localTextoParticao);
                this.emitirCarregamentoVariavel(localIndiceParticao);
                this.emitirCarregamentoVariavel(localSeparadorParticao);
                this.instrucoes.push('callvirt instance int32 [mscorlib]System.String::get_Length()');
                this.instrucoes.push('add');
                this.instrucoes.push('callvirt instance string [mscorlib]System.String::Substring(int32)');
                this.instrucoes.push('stelem.ref');

                this.emitirRotulo(rotuloFimParticao);
                this.emitirCarregamentoVariavel(localResultadoParticao);
                return 'texto()';
            }


            if (expressao.entidadeChamada.simbolo.lexema === 'encontrar') {
                if (!this.tipoEhTexto(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
                if (expressao.argumentos.length < 1 || expressao.argumentos.length > 2) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' espera 1 ou 2 argumentos.`);
                }
                if (this.resolverTipoConstruto(expressao.argumentos[0]) !== 'texto') {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' requer subtexto de tipo texto.`);
                }
                if (expressao.argumentos[1]) {
                    const tipoIndiceInicio = this.resolverTipoConstruto(expressao.argumentos[1]);
                    if (!this.tipoEhNumerico(tipoIndiceInicio) || tipoIndiceInicio === 'numero') {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' requer índice inicial inteiro.`);
                    }
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                await this.emitirConstrutoParaTipoEsperado(expressao.argumentos[0], 'texto');
                if (expressao.argumentos[1]) {
                    await expressao.argumentos[1].aceitar(this as any);
                    this.instrucoes.push('callvirt instance int32 [mscorlib]System.String::IndexOf(string, int32)');
                } else {
                    this.instrucoes.push('callvirt instance int32 [mscorlib]System.String::IndexOf(string)');
                }
                return 'inteiro';
            }

            if (expressao.entidadeChamada.simbolo.lexema === 'iniciaCom') {
                if (!this.tipoEhTexto(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
                if (expressao.argumentos.length !== 1) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' espera 1 argumento.`);
                }
                if (this.resolverTipoConstruto(expressao.argumentos[0]) !== 'texto') {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' requer argumento de texto.`);
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                await this.emitirConstrutoParaTipoEsperado(expressao.argumentos[0], 'texto');
                this.instrucoes.push('callvirt instance bool [mscorlib]System.String::StartsWith(string)');
                return 'logico';
            }

            if (expressao.entidadeChamada.simbolo.lexema === 'terminaCom') {
                if (!this.tipoEhTexto(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
                if (expressao.argumentos.length !== 1) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' espera 1 argumento.`);
                }
                if (this.resolverTipoConstruto(expressao.argumentos[0]) !== 'texto') {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' requer argumento de texto.`);
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                await this.emitirConstrutoParaTipoEsperado(expressao.argumentos[0], 'texto');
                this.instrucoes.push('callvirt instance bool [mscorlib]System.String::EndsWith(string)');
                return 'logico';
            }

            if (expressao.entidadeChamada.simbolo.lexema === 'minusculo') {
                if (!this.tipoEhTexto(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
                if (expressao.argumentos.length !== 0) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não aceita argumentos nesta fase do compilador.`);
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                this.instrucoes.push('callvirt instance string [mscorlib]System.String::ToLower()');
                return 'texto';
            }

            if (expressao.entidadeChamada.simbolo.lexema === 'substituir') {
                if (!this.tipoEhTexto(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
                if (expressao.argumentos.length !== 2) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' espera 2 argumento(s).`);
                }
                if (this.resolverTipoConstruto(expressao.argumentos[0]) !== 'texto' || this.resolverTipoConstruto(expressao.argumentos[1]) !== 'texto') {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' requer argumentos de texto.`);
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                await this.emitirConstrutoParaTipoEsperado(expressao.argumentos[0], 'texto');
                await this.emitirConstrutoParaTipoEsperado(expressao.argumentos[1], 'texto');
                this.instrucoes.push('callvirt instance string [mscorlib]System.String::Replace(string, string)');
                return 'texto';
            }

            if (expressao.entidadeChamada.simbolo.lexema === 'divida' || expressao.entidadeChamada.simbolo.lexema === 'dividir') {
                if (!this.tipoEhTexto(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }
                if (expressao.argumentos.length < 1 || expressao.argumentos.length > 2) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' espera 1 ou 2 argumentos.`);
                }
                if (this.resolverTipoConstruto(expressao.argumentos[0]) !== 'texto') {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' requer argumento de texto.`);
                }

                if (expressao.argumentos[1]) {
                    const tipoLimite = this.resolverTipoConstruto(expressao.argumentos[1]);
                    if (!this.tipoEhNumerico(tipoLimite) || tipoLimite === 'numero') {
                        throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' requer limite inteiro quando informado.`);
                    }
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                await this.emitirConstrutoParaTipoEsperado(expressao.argumentos[0], 'texto');
                this.instrucoes.push('callvirt instance char[] [mscorlib]System.String::ToCharArray()');
                if (expressao.argumentos[1]) {
                    await expressao.argumentos[1].aceitar(this as any);
                    this.instrucoes.push('callvirt instance string[] [mscorlib]System.String::Split(char[], int32)');
                } else {
                    this.instrucoes.push('callvirt instance string[] [mscorlib]System.String::Split(char[])');
                }
                return 'texto()';
            }

            if (expressao.argumentos.length !== 0) {
                throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não aceita argumentos nesta fase do compilador.`);
            }

            if (expressao.entidadeChamada.simbolo.lexema === 'tamanho') {
                await expressao.entidadeChamada.objeto.aceitar(this as any);
                this.emitirCarregamentoTamanhoColecao(tipoObjeto);
                return 'inteiro';
            }

            if (expressao.entidadeChamada.simbolo.lexema === 'chaves') {
                if (!this.tipoEhDicionario(tipoObjeto)) {
                    throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
                }

                await expressao.entidadeChamada.objeto.aceitar(this as any);
                this.emitirConstrucaoListaDeChavesDicionario(tipoObjeto);
                return this.mapearTipoColecaoChaves(tipoObjeto);
            }

            if (expressao.entidadeChamada.simbolo.lexema === 'valores') {
                await expressao.entidadeChamada.objeto.aceitar(this as any);
                if (this.tipoEhVetor(tipoObjeto)) {
                    return tipoObjeto;
                }
                if (this.tipoEhDicionario(tipoObjeto)) {
                    this.emitirConstrucaoListaDeValoresDicionario(tipoObjeto);
                    return this.mapearTipoColecaoValores(tipoObjeto);
                }

                throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
            }

            throw new ErroCompilador(`Método '${expressao.entidadeChamada.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
        }

        if (!(expressao.entidadeChamada instanceof Variavel)) {
            if (expressao.entidadeChamada instanceof Super) {
                if (expressao.argumentos.length !== 0) {
                    throw new ErroCompilador("'super()' não aceita argumentos nesta fase do compilador.");
                }

                const tipoSuper = this.resolverTipoConstruto(expressao.entidadeChamada);
                this.instrucoes.push('ldarg 0');
                return tipoSuper;
            }

            throw new ErroCompilador('Chamada suportada apenas para funções nomeadas nesta fase do compilador.');
        }

        const classe = this.classes.get(expressao.entidadeChamada.simbolo.lexema);
        if (classe) {
            const construtor = classe.metodos.get('construtor');
            const parametros = construtor?.parametros || [];
            if (expressao.argumentos.length !== parametros.length) {
                throw new ErroCompilador(
                    `Construtor '${classe.nome}' espera ${parametros.length} argumento(s), mas recebeu ${expressao.argumentos.length}.`
                );
            }

            for (let indice = 0; indice < expressao.argumentos.length; indice++) {
                const argumento = expressao.argumentos[indice];
                const parametro = parametros[indice];
                const tipoArgumento = this.resolverTipoConstruto(argumento);
                const compativel =
                    tipoArgumento === parametro.tipoDelegua ||
                    (parametro.tipoDelegua === 'numero' && tipoArgumento === 'inteiro');
                if (!compativel) {
                    throw new ErroCompilador(
                        `Argumento ${indice + 1} do construtor '${classe.nome}' deve ser '${parametro.tipoDelegua}', mas recebeu '${tipoArgumento}'.`
                    );
                }

                await argumento.aceitar(this as any);
                if (parametro.tipoDelegua === 'numero' && tipoArgumento === 'inteiro') {
                    this.instrucoes.push('conv.r8');
                }
            }

            this.instrucoes.push(
                `newobj instance void class ${classe.nome}::.ctor(${parametros.map((parametro) => parametro.tipoCil).join(', ')})`
            );
            return classe.nome;
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

    async visitarExpressaoAcessoMetodoOuPropriedade(expressao: AcessoMetodoOuPropriedade): Promise<string> {
        const tipoObjeto = this.resolverTipoConstruto(expressao.objeto);
        const classe = this.classes.get(tipoObjeto);
        if (classe) {
            const localizacaoCampo = this.localizarCampoClasse(classe.nome, expressao.simbolo.lexema);
            if (!localizacaoCampo) {
                throw new ErroCompilador(`Propriedade '${expressao.simbolo.lexema}' não definida na classe '${classe.nome}'.`);
            }

            await expressao.objeto.aceitar(this as any);
            this.instrucoes.push(
                `ldfld ${localizacaoCampo.campo.tipoCil} class ${localizacaoCampo.classeDona.nome}::${localizacaoCampo.campo.nome}`
            );
            return localizacaoCampo.campo.tipoDelegua;
        }

        if (
            expressao.simbolo.lexema === 'tamanho' &&
            (this.tipoEhTexto(tipoObjeto) || this.tipoEhVetor(tipoObjeto) || this.tipoEhDicionario(tipoObjeto) || this.tipoEhTupla(tipoObjeto))
        ) {
            await expressao.objeto.aceitar(this as any);
            this.emitirCarregamentoTamanhoColecao(tipoObjeto);
            return 'inteiro';
        }

        if (expressao.simbolo.lexema === 'chaves') {
            await expressao.objeto.aceitar(this as any);
            if (!this.tipoEhDicionario(tipoObjeto)) {
                throw new ErroCompilador(`Acesso '${expressao.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
            }

            this.emitirConstrucaoListaDeChavesDicionario(tipoObjeto);
            return this.mapearTipoColecaoChaves(tipoObjeto);
        }

        if (expressao.simbolo.lexema === 'valores') {
            await expressao.objeto.aceitar(this as any);
            if (this.tipoEhVetor(tipoObjeto)) {
                return tipoObjeto;
            }
            if (this.tipoEhDicionario(tipoObjeto)) {
                this.emitirConstrucaoListaDeValoresDicionario(tipoObjeto);
                return this.mapearTipoColecaoValores(tipoObjeto);
            }
            throw new ErroCompilador(`Acesso '${expressao.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
        }

        throw new ErroCompilador(`Acesso '${expressao.simbolo.lexema}' não implementado para '${tipoObjeto}'.`);
    }

    async visitarExpressaoIsto(): Promise<string> {
        if (!this.classeAtual || !this.metodoClasseAtual) {
            throw new ErroCompilador("'isto' só pode ser usado dentro de métodos de classe.");
        }

        this.instrucoes.push('ldarg 0');
        return this.classeAtual.nome;
    }

    async visitarExpressaoSuper(expressao: Super): Promise<string> {
        if (!this.classeAtual || !this.metodoClasseAtual) {
            throw new ErroCompilador("'super' só pode ser usado dentro de métodos de classe.");
        }

        if (!this.classeAtual.superClasseNome) {
            throw new ErroCompilador("'super' só pode ser usado em classes com herança.");
        }

        this.instrucoes.push('ldarg 0');
        return this.classeAtual.superClasseNome;
    }

    async visitarExpressaoDefinirValor(expressao: DefinirValor): Promise<any> {
        const tipoObjeto = this.resolverTipoConstruto(expressao.objeto);
        const classe = this.classes.get(tipoObjeto);
        if (!classe) {
            throw new ErroCompilador('Definição de propriedade suportada apenas para instâncias de classe nesta fase do compilador.');
        }

        const nomeCampo = expressao.nome.lexema;
        const localizacaoCampo = this.localizarCampoClasse(classe.nome, nomeCampo);
        let campo = localizacaoCampo?.campo;
        const classeDonaCampo = localizacaoCampo?.classeDona || classe;
        const tipoValor = this.resolverTipoConstruto(expressao.valor);

        if (!campo) {
            campo = {
                nome: nomeCampo,
                tipoDelegua: tipoValor,
                tipoCil: this.mapearTipoCil(tipoValor),
            };
            classe.campos.set(nomeCampo, campo);
        }

        const compativel =
            tipoValor === campo.tipoDelegua ||
            (campo.tipoDelegua === 'numero' && tipoValor === 'inteiro');
        if (!compativel) {
            throw new ErroCompilador(
                `Propriedade '${classe.nome}.${nomeCampo}' é '${campo.tipoDelegua}', mas recebeu '${tipoValor}'.`
            );
        }

        await expressao.objeto.aceitar(this as any);
        await this.emitirConstrutoParaTipoEsperado(expressao.valor, campo.tipoDelegua);
        this.instrucoes.push(`stfld ${campo.tipoCil} class ${classeDonaCampo.nome}::${nomeCampo}`);
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

    private async compilarMetodoClasse(declaracaoMetodo: FuncaoDeclaracao): Promise<string> {
        if (!this.classeAtual) {
            throw new ErroCompilador('Contexto de classe ausente durante compilação de método.');
        }

        const metodoClasse = this.classeAtual.metodos.get(declaracaoMetodo.simbolo.lexema);
        if (!metodoClasse) {
            throw new ErroCompilador(`Método '${declaracaoMetodo.simbolo.lexema}' não registrado na classe '${this.classeAtual.nome}'.`);
        }

        const estadoAnterior = this.capturarEstadoCompilacao();
        this.instrucoes = [];
        this.variaveis = new Map();
        this.locaisTemporarios = [];
        this.proximoIndiceLocal = 0;
        this.pilhaRotulosLoop = [];
        this.funcaoAtual = null;
        this.metodoClasseAtual = metodoClasse;

        try {
            for (let indice = 0; indice < metodoClasse.parametros.length; indice++) {
                const parametro = metodoClasse.parametros[indice];
                this.variaveis.set(parametro.nome, {
                    indice: indice + 1,
                    tipoCil: parametro.tipoCil,
                    tipoDelegua: parametro.tipoDelegua,
                    armazenamento: 'argumento',
                });
            }

            if (metodoClasse.eConstrutor) {
                this.instrucoes.push('ldarg 0');
                if (this.classeAtual.superClasseNome) {
                    const construtorBase = this.classes.get(this.classeAtual.superClasseNome)?.metodos.get('construtor');
                    if (!construtorBase) {
                        throw new ErroCompilador(`Classe base '${this.classeAtual.superClasseNome}' não possui construtor acessível.`);
                    }

                    if (construtorBase.parametros.length !== 0) {
                        throw new ErroCompilador(
                            `Construtor da classe base '${this.classeAtual.superClasseNome}' deve ser sem parâmetros para herança nesta fase do compilador.`
                        );
                    }

                    this.instrucoes.push(`call instance void class ${this.classeAtual.superClasseNome}::.ctor()`);
                } else {
                    this.instrucoes.push('call instance void [mscorlib]System.Object::.ctor()');
                }
            }

            for (const item of declaracaoMetodo.funcao.corpo) {
                await item.aceitar(this as any);
            }

            if (metodoClasse.tipoRetornoDelegua === 'vazio') {
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
            const cabecalhoMetodo = metodoClasse.eConstrutor
                ? `.method public hidebysig specialname rtspecialname instance void ${metodoClasse.nomeCil}(${metodoClasse.parametros
                      .map((parametro) => `${parametro.tipoCil} ${parametro.nome}`)
                      .join(', ')}) cil managed`
                : `.method public hidebysig instance ${metodoClasse.tipoRetornoCil} ${metodoClasse.nomeCil}(${metodoClasse.parametros
                      .map((parametro) => `${parametro.tipoCil} ${parametro.nome}`)
                      .join(', ')}) cil managed`;

            return (
                `${cabecalhoMetodo}\n` +
                `  {\n` +
                `    .maxstack 8\n` +
                linhaLocais +
                (corpo ? corpo + '\n' : '') +
                `  }`
            );
        } finally {
            this.restaurarEstadoCompilacao(estadoAnterior);
            this.metodoClasseAtual = null;
        }
    }

    async visitarDeclaracaoClasse(declaracao: Classe): Promise<any> {
        const classe = this.classes.get(declaracao.simbolo.lexema);
        if (!classe) {
            throw new ErroCompilador(`Classe '${declaracao.simbolo.lexema}' não registrada.`);
        }

        if (classe.superClasseNome && !this.classes.has(classe.superClasseNome)) {
            throw new ErroCompilador(`Classe base '${classe.superClasseNome}' não declarada para '${classe.nome}'.`);
        }

        const estadoAnterior = this.capturarEstadoCompilacao();
        this.classeAtual = classe;
        this.funcaoAtual = null;

        try {
            const metodosOrdenados = [...declaracao.metodos].sort((a, b) => {
                if (a.simbolo.lexema === 'construtor') return -1;
                if (b.simbolo.lexema === 'construtor') return 1;
                return 0;
            });

            const metodosCompilados: string[] = [];
            const possuiConstrutorDeclarado = declaracao.metodos.some((metodo) => metodo.simbolo.lexema === 'construtor');
            if (!possuiConstrutorDeclarado) {
                if (classe.superClasseNome) {
                    const construtorBase = this.classes.get(classe.superClasseNome)?.metodos.get('construtor');
                    if (!construtorBase) {
                        throw new ErroCompilador(`Classe base '${classe.superClasseNome}' não possui construtor acessível.`);
                    }

                    if (construtorBase.parametros.length !== 0) {
                        throw new ErroCompilador(
                            `Construtor da classe base '${classe.superClasseNome}' deve ser sem parâmetros para herança nesta fase do compilador.`
                        );
                    }
                }

                const chamadaBase = classe.superClasseNome
                    ? `call instance void class ${classe.superClasseNome}::.ctor()`
                    : 'call instance void [mscorlib]System.Object::.ctor()';

                metodosCompilados.push(
                    `.method public hidebysig specialname rtspecialname instance void .ctor() cil managed\n` +
                        `  {\n` +
                        `    .maxstack 8\n` +
                        `    ldarg 0\n` +
                        `    ${chamadaBase}\n` +
                        `    ret\n` +
                        `  }`
                );
            }

            for (const metodo of metodosOrdenados) {
                metodosCompilados.push(await this.compilarMetodoClasse(metodo));
            }

            const campos = [...classe.campos.values()]
                .map((campo) => `  .field public ${campo.tipoCil} ${campo.nome}`)
                .join('\n');

            this.classesCompiladas.push(
                `.class public auto ansi beforefieldinit ${classe.nome}\n` +
                    `       extends ${classe.superClasseNome ? `class ${classe.superClasseNome}` : '[mscorlib]System.Object'}\n` +
                    `{\n` +
                    (campos ? `${campos}\n\n` : '') +
                    `${metodosCompilados.join('\n\n')}\n` +
                    `}`
            );
        } finally {
            this.restaurarEstadoCompilacao(estadoAnterior);
            this.classeAtual = null;
        }
    }

    async visitarDeclaracaoDefinicaoFuncao(declaracao: FuncaoDeclaracao): Promise<any> {
        if (this.funcaoAtual || this.metodoClasseAtual) {
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

    async visitarDeclaracaoTente(declaracao: any): Promise<any> {
        if (declaracao.caminhoSenao) {
            throw new ErroCompilador("Bloco 'senão' em 'tente' ainda não é suportado neste compilador.");
        }

        if ((!declaracao.caminhoPegue || declaracao.caminhoPegue.length === 0) && !declaracao.caminhoFinalmente) {
            throw new ErroCompilador("'tente' requer ao menos um bloco 'pegue' ou 'finalmente'.");
        }

        const rotuloFim = this.gerarRotulo();
        this.instrucoes.push('.try');
        this.instrucoes.push('{');
        for (const item of declaracao.caminhoTente || []) {
            await item.aceitar(this as any);
        }
        this.instrucoes.push(`leave ${rotuloFim}`);
        this.instrucoes.push('}');

        for (const blocoPegue of declaracao.caminhoPegue || []) {
            if (blocoPegue.parametro || blocoPegue.tipoExcecao) {
                throw new ErroCompilador("Blocos 'pegue' tipados ou com parâmetro ainda não são suportados neste compilador.");
            }

            this.instrucoes.push('catch [mscorlib]System.Exception');
            this.instrucoes.push('{');
            this.instrucoes.push('pop');
            for (const item of blocoPegue.corpo || []) {
                await item.aceitar(this as any);
            }
            this.instrucoes.push(`leave ${rotuloFim}`);
            this.instrucoes.push('}');
        }

        if (declaracao.caminhoFinalmente) {
            this.instrucoes.push('finally');
            this.instrucoes.push('{');
            for (const item of declaracao.caminhoFinalmente) {
                await item.aceitar(this as any);
            }
            this.instrucoes.push('endfinally');
            this.instrucoes.push('}');
        }

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
        if (!this.funcaoAtual && !this.metodoClasseAtual) {
            throw new ErroCompilador('`retorna` só pode ser usado dentro de funções ou métodos.');
        }

        const escopoRetorno = this.funcaoAtual || this.metodoClasseAtual;
        if (!escopoRetorno) {
            throw new ErroCompilador('Escopo de retorno inválido.');
        }

        if (escopoRetorno.tipoRetornoDelegua === 'vazio') {
            if (declaracao.valor) {
                throw new ErroCompilador(`'${escopoRetorno.nome}' não deve retornar valor.`);
            }

            this.instrucoes.push('ret');
            return;
        }

        if (!declaracao.valor) {
            throw new ErroCompilador(`'${escopoRetorno.nome}' deve retornar valor.`);
        }

        const tipoValor = this.resolverTipoConstruto(declaracao.valor);
        const tipoCompativel =
            tipoValor === escopoRetorno.tipoRetornoDelegua ||
            (escopoRetorno.tipoRetornoDelegua === 'numero' && tipoValor === 'inteiro');

        if (!tipoCompativel) {
            throw new ErroCompilador(
                `'${escopoRetorno.nome}' retorna '${escopoRetorno.tipoRetornoDelegua}', mas recebeu '${tipoValor}'.`
            );
        }

        await declaracao.valor.aceitar(this as any);
        if (escopoRetorno.tipoRetornoDelegua === 'numero' && tipoValor === 'inteiro') {
            this.instrucoes.push('conv.r8');
        }

        this.instrucoes.push('ret');
    }

    async visitarExpressaoFalhar(expressao: Falhar | any): Promise<any> {
        if (!expressao.explicacao) {
            throw new ErroCompilador("'falhar' requer uma explicação de texto nesta fase do compilador.");
        }

        const explicacao = expressao.explicacao.expressao || expressao.explicacao;
        const tipoExplicacao = this.resolverTipoConstruto(explicacao);
        if (tipoExplicacao !== 'texto') {
            throw new ErroCompilador("'falhar' requer explicação do tipo texto nesta fase do compilador.");
        }

        await explicacao.aceitar(this as any);
        this.instrucoes.push('newobj instance void [mscorlib]System.Exception::.ctor(string)');
        this.instrucoes.push('throw');
    }

    async visitarExpressaoFormatacaoEscrita(expressao: FormatacaoEscrita): Promise<string> {
        const tipoConteudo = this.resolverTipoConstruto(expressao.expressao);
        await expressao.expressao.aceitar(this as any);

        if (this.tipoEhNumerico(tipoConteudo) && expressao.casasDecimais > 0) {
            if (tipoConteudo === 'inteiro') {
                this.instrucoes.push('conv.r8');
            }

            this.instrucoes.push(`ldstr "F${expressao.casasDecimais}"`);
            this.instrucoes.push('call instance string [mscorlib]System.Double::ToString(string)');
        } else {
            this.emitirConversaoParaTexto(tipoConteudo);
        }

        if (expressao.espacos > 0) {
            this.instrucoes.push(`ldstr "${' '.repeat(expressao.espacos)}"`);
            this.instrucoes.push('call string [mscorlib]System.String::Concat(string, string)');
        }

        return 'texto';
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
                case 'inteiro()':
                    this.instrucoes.push('call void [mscorlib]System.Console::WriteLine(object)');
                    break;
                case 'numero()':
                    this.instrucoes.push('call void [mscorlib]System.Console::WriteLine(object)');
                    break;
                case 'logico()':
                    this.instrucoes.push('call void [mscorlib]System.Console::WriteLine(object)');
                    break;
                case 'texto()':
                    this.instrucoes.push('call void [mscorlib]System.Console::WriteLine(object)');
                    break;
                default:
                    throw new ErroCompilador(`Não sabe como escrever valor de tipo '${tipo}'.`);
            }
        }
    }
}
