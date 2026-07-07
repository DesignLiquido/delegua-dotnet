import { VisitanteDeleguaInterface } from '@designliquido/delegua/interfaces';

import { ErroCompilador } from './erros/erro-compilador';

function naoImplementado(nome: string): never {
    throw new ErroCompilador(`Construto '${nome}' ainda não implementado neste compilador.`);
}

/**
 * Stub de todos os métodos de `VisitanteDeleguaInterface` que ainda não são
 * suportados nesta primeira versão do compilador. `CompiladorDotnet` estende
 * esta classe e sobrescreve apenas os métodos dos construtos que já sabe compilar.
 */
export class VisitanteBaseNaoImplementado implements VisitanteDeleguaInterface {
    // VisitanteComumInterface
    visitarDeclaracaoCabecalhoPrograma(declaracao?: any): any { return naoImplementado('cabeçalho de programa'); }
    visitarDeclaracaoClasse(declaracao?: any): any { return naoImplementado('classe'); }
    visitarDeclaracaoComentario(declaracao?: any): any { return naoImplementado('comentário'); }
    visitarDeclaracaoConst(declaracao?: any): any { return naoImplementado('constante'); }
    visitarDeclaracaoConstMultiplo(declaracao?: any): any { return naoImplementado('constante múltipla'); }
    visitarDeclaracaoDeExpressao(declaracao?: any): any { return naoImplementado('expressão'); }
    visitarDeclaracaoDefinicaoFuncao(declaracao?: any): any { return naoImplementado('função'); }
    visitarDeclaracaoEnquanto(declaracao?: any): any { return naoImplementado('enquanto'); }
    visitarDeclaracaoEscolha(declaracao?: any): any { return naoImplementado('escolha'); }
    visitarDeclaracaoEscreva(declaracao?: any): any { return naoImplementado('escreva'); }
    visitarDeclaracaoEscrevaMesmaLinha(declaracao?: any): any { return naoImplementado('escreva-mesma-linha'); }
    visitarDeclaracaoFazer(declaracao?: any): any { return naoImplementado('fazer'); }
    visitarDeclaracaoInicioAlgoritmo(declaracao?: any): any { return naoImplementado('início-algoritmo'); }
    visitarDeclaracaoPara(declaracao?: any): any { return naoImplementado('para'); }
    visitarDeclaracaoSe(declaracao?: any): any { return naoImplementado('se'); }
    visitarDeclaracaoTendoComo(declaracao?: any): any { return naoImplementado('tendo-como'); }
    visitarDeclaracaoTente(declaracao?: any): any { return naoImplementado('tente'); }
    visitarDeclaracaoTextoDocumentacao(declaracao?: any): any { return naoImplementado('texto de documentação'); }
    visitarDeclaracaoVar(declaracao?: any): any { return naoImplementado('var'); }
    visitarDeclaracaoVarMultiplo(declaracao?: any): any { return naoImplementado('var múltiplo'); }
    visitarExpressaoDeAtribuicao(expressao?: any): any { return naoImplementado('atribuição'); }
    visitarExpressaoAcessoIndiceVariavel(expressao?: any): any { return naoImplementado('acesso por índice'); }
    visitarExpressaoAcessoIntervaloVariavel(expressao?: any): any { return naoImplementado('acesso por intervalo'); }
    visitarExpressaoAcessoElementoMatriz(expressao?: any): any { return naoImplementado('acesso a elemento de matriz'); }
    visitarExpressaoAcessoMetodo(expressao?: any): any { return naoImplementado('acesso a método'); }
    visitarExpressaoAcessoMetodoOuPropriedade(expressao?: any): any { return naoImplementado('acesso a método ou propriedade'); }
    visitarExpressaoAcessoPropriedade(expressao?: any): any { return naoImplementado('acesso a propriedade'); }
    visitarExpressaoAgrupamento(expressao?: any): any { return naoImplementado('agrupamento'); }
    visitarExpressaoArgumentoReferenciaFuncao(expressao?: any): any { return naoImplementado('argumento por referência'); }
    visitarExpressaoAtribuicaoPorIndice(expressao?: any): any { return naoImplementado('atribuição por índice'); }
    visitarExpressaoAtribuicaoPorIndicesMatriz(expressao?: any): any { return naoImplementado('atribuição por índices de matriz'); }
    visitarExpressaoBinaria(expressao?: any): any { return naoImplementado('operador binário'); }
    visitarExpressaoBloco(declaracao?: any): any { return naoImplementado('bloco'); }
    visitarExpressaoComentario(expressao?: any): any { return naoImplementado('comentário'); }
    visitarExpressaoContinua(declaracao?: any): any { return naoImplementado('continua'); }
    visitarExpressaoDeChamada(expressao?: any): any { return naoImplementado('chamada de função'); }
    visitarExpressaoDefinirValor(expressao?: any): any { return naoImplementado('definir valor'); }
    visitarExpressaoFuncaoConstruto(expressao?: any): any { return naoImplementado('função anônima'); }
    visitarExpressaoDeVariavel(expressao?: any): any { return naoImplementado('variável'); }
    visitarExpressaoDicionario(expressao?: any): any { return naoImplementado('dicionário'); }
    visitarExpressaoExpressaoRegular(expressao?: any): any { return naoImplementado('expressão regular'); }
    visitarExpressaoFalhar(expressao?: any): any { return naoImplementado('falhar'); }
    visitarExpressaoFimPara(declaracao?: any): any { return naoImplementado('fim-para'); }
    visitarExpressaoFormatacaoEscrita(declaracao?: any): any { return naoImplementado('formatação de escrita'); }
    visitarExpressaoIsto(expressao?: any): any { return naoImplementado('isto'); }
    visitarExpressaoLeia(expressao?: any): any { return naoImplementado('leia'); }
    visitarExpressaoLiteral(expressao?: any): any { return naoImplementado('literal'); }
    visitarExpressaoLogica(expressao?: any): any { return naoImplementado('operador lógico e/ou'); }
    visitarExpressaoReferenciaFuncao(expressao?: any): any { return naoImplementado('referência de função'); }
    visitarExpressaoRetornar(expressao?: any): any { return naoImplementado('retorna'); }
    visitarExpressaoSeparador(expressao?: any): any { return naoImplementado('separador'); }
    visitarExpressaoSuper(expressao?: any): any { return naoImplementado('super'); }
    visitarExpressaoSustar(declaracao?: any): any { return naoImplementado('sustar'); }
    visitarExpressaoTupla(expressao?: any): any { return naoImplementado('tupla'); }
    visitarExpressaoTuplaN(expressao?: any): any { return naoImplementado('tupla-n'); }
    visitarExpressaoTipoDe(expressao?: any): any { return naoImplementado('tipo-de'); }
    visitarExpressaoUnaria(expressao?: any): any { return naoImplementado('operador unário'); }
    visitarExpressaoVetor(expressao?: any): any { return naoImplementado('vetor'); }

    // VisitanteDeleguaInterface
    visitarDeclaracaoAjuda(declaracao?: any): any { return naoImplementado('ajuda'); }
    visitarDeclaracaoExtensao(declaracao?: any): any { return naoImplementado('extensão'); }
    visitarDeclaracaoInterface(declaracao?: any): any { return naoImplementado('interface'); }
    visitarDeclaracaoImportar(declaracao?: any): any { return naoImplementado('importar'); }
    visitarDeclaracaoParaCada(declaracao?: any): any { return naoImplementado('para-cada'); }
    visitarExpressaoAjuda(expressao?: any): any { return naoImplementado('ajuda'); }
    visitarExpressaoEnquanto(expressao?: any): any { return naoImplementado('enquanto (como expressão)'); }
    visitarExpressaoElvis(expressao?: any): any { return naoImplementado('operador elvis'); }
    visitarExpressaoFazer(expressao?: any): any { return naoImplementado('fazer (como expressão)'); }
    visitarExpressaoImportar(expressao?: any): any { return naoImplementado('importar (como expressão)'); }
    visitarExpressaoListaCompreensao(listaCompreensao?: any): any { return naoImplementado('lista por compreensão'); }
    visitarExpressaoPara(expressao?: any): any { return naoImplementado('para (como expressão)'); }
    visitarExpressaoParaCada(expressao?: any): any { return naoImplementado('para-cada (como expressão)'); }
    visitarExpressaoSeTernario(expressao?: any): any { return naoImplementado('se ternário'); }
}
