/// <reference types="jest" />
import { CompiladorDotnet } from '../fontes/compilador-dotnet';
import { ErroCompilador } from '../fontes/erros/erro-compilador';

describe('CompiladorDotnet - Controle de fluxo', () => {
    it('Se com comparação numérica', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar(['var x = 0', 'se (x < 1) { escreva(42) }']);

        expect(resultado).toContain('ldloc 0');
        expect(resultado).toContain('ldc.i4 1');
        expect(resultado).toContain('clt');
        expect(resultado).toMatch(/brfalse IL_\d{4}/);
        expect(resultado).toContain('ldc.i4 42');
    });

    it('Se senao com operador lógico', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'se (verdadeiro e falso) { escreva(1) } senao { escreva(2) }',
        ]);

        expect(resultado).toContain('ldc.i4.1');
        expect(resultado).toContain('ldc.i4.0');
        expect(resultado).toMatch(/brfalse IL_\d{4}/);
        expect(resultado).toContain('ldc.i4 1');
        expect(resultado).toContain('ldc.i4 2');
    });

    it('Atribuição em bloco de se', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var x = 0',
            'se (verdadeiro) { x = x + 1 }',
            'escreva(x)',
        ]);

        expect(resultado).toContain('stloc 0');
        expect(resultado).toContain('ldloc 0');
        expect(resultado).toContain('add');
        expect(resultado.match(/stloc 0/g)?.length).toBeGreaterThanOrEqual(2);
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(int32)');
    });

    it('Enquanto reavalia a condição e atualiza variável', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var x = 0',
            'enquanto (x < 3) { x = x + 1 }',
            'escreva(x)',
        ]);

        expect(resultado).toMatch(/IL_\d{4}:/);
        expect(resultado).toContain('clt');
        expect(resultado).toMatch(/brfalse IL_\d{4}/);
        expect(resultado).toMatch(/br IL_\d{4}/);
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(int32)');
    });

    it('Para executa inicializador, condição e incremento', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'para (var i = 0; i < 3; i = i + 1) { escreva(i) }',
        ]);

        expect(resultado).toContain('.locals init (int32 V_0)');
        expect(resultado).toContain('ldc.i4 0');
        expect(resultado).toContain('stloc 0');
        expect(resultado).toContain('clt');
        expect(resultado).toContain('add');
        expect(resultado).toMatch(/brfalse IL_\d{4}/);
        expect(resultado).toMatch(/br IL_\d{4}/);
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(int32)');
    });

    it('Para aceita inicializador e incremento omitidos', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var x = 0',
            'para (; x < 2; ) { x = x + 1 }',
            'escreva(x)',
        ]);

        expect(resultado).toContain('stloc 0');
        expect(resultado).toContain('clt');
        expect(resultado).toMatch(/brfalse IL_\d{4}/);
        expect(resultado.match(/stloc 0/g)?.length).toBeGreaterThanOrEqual(2);
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(int32)');
    });

    it('Continua em enquanto salta para a próxima iteração', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var x = 0',
            'enquanto (x < 5) { x = x + 1; se (x == 2) { continua } escreva(x) }',
        ]);

        expect(resultado).toContain('ceq');
        expect(resultado).toMatch(/br IL_\d{4}/);
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(int32)');
    });

    it('Sustar em para salta para o fim do laço', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var x = 0',
            'para (; x < 5; x = x + 1) { se (x == 3) { sustar } escreva(x) }',
            'escreva(x)',
        ]);

        expect(resultado).toContain('ceq');
        expect(resultado).toMatch(/brfalse IL_\d{4}/);
        expect(resultado.match(/call void \[mscorlib\]System\.Console::WriteLine\(int32\)/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('Escolha com casos inteiros usa a primeira correspondência', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var x = 2',
            'escolha x {',
            'caso 1:',
            '  escreva(1)',
            'caso 2:',
            '  escreva(2)',
            'padrao:',
            '  escreva(0)',
            '}',
        ]);

        expect(resultado).toContain('.locals init (int32 V_0, int32 V_1)');
        expect(resultado).toContain('ldloc 1');
        expect(resultado).toContain('ceq');
        expect(resultado).toContain('ldc.i4 2');
        expect(resultado).toContain('ldc.i4 0');
    });

    it('Escolha aceita múltiplos caso para o mesmo bloco', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var x = 3',
            'escolha x {',
            'caso 1:',
            'caso 3:',
            '  escreva(13)',
            'padrao:',
            '  escreva(0)',
            '}',
        ]);

        expect(resultado.match(/brtrue IL_\d{4}/g)?.length).toBeGreaterThanOrEqual(2);
        expect(resultado).toContain('ldc.i4 13');
    });

    it('Escolha compara textos', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var nome = "delegua"',
            'escolha nome {',
            'caso "java":',
            '  escreva(1)',
            'caso "delegua":',
            '  escreva(2)',
            'padrao:',
            '  escreva(0)',
            '}',
        ]);

        expect(resultado).toContain('call bool [mscorlib]System.String::op_Equality(string, string)');
        expect(resultado).toContain('ldc.i4 2');
    });

    it('Escolha usa padrao quando nenhum caso corresponde', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var x = 9',
            'escolha x {',
            'caso 1:',
            '  escreva(1)',
            'padrao:',
            '  escreva(99)',
            '}',
        ]);

        expect(resultado).toContain('ldc.i4 99');
        expect(resultado).toMatch(/br IL_\d{4}/);
    });

    it('Escolha com caso de tipo incompatível falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar(['var x = "texto"', 'escolha x {', 'caso 1:', '  escreva(1)', '}'])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Funcao com retorno explícito compila para método estático e chamada', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'funcao soma(a: inteiro, b: inteiro): inteiro { retorna a + b }',
            'escreva(soma(1, 2))',
        ]);

        expect(resultado).toContain('.method public static int32 soma(int32 a, int32 b) cil managed');
        expect(resultado).toContain('ldarg 0');
        expect(resultado).toContain('ldarg 1');
        expect(resultado).toContain('call int32 Programa::soma(int32, int32)');
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(int32)');
    });

    it('Funcao pode declarar variáveis locais e usá-las no retorno', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'funcao dobro(a: inteiro): inteiro { var resultado = a + a retorna resultado }',
            'escreva(dobro(3))',
        ]);

        expect(resultado).toContain('.method public static int32 dobro(int32 a) cil managed');
        expect(resultado).toContain('.locals init (int32 V_0)');
        expect(resultado).toContain('stloc 0');
        expect(resultado).toContain('ldloc 0');
    });

    it('Funcao sem parâmetros compila chamada direta', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'funcao valor(): inteiro { retorna 1 }',
            'escreva(valor())',
        ]);

        expect(resultado).toContain('.method public static int32 valor() cil managed');
        expect(resultado).toContain('call int32 Programa::valor()');
    });

    it('Funcao vazia pode ser chamada como expressão', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'funcao nada(): vazio { retorna }',
            'nada()',
        ]);

        expect(resultado).toContain('.method public static void nada() cil managed');
        expect(resultado).toContain('call void Programa::nada()');
        expect(resultado).not.toContain('pop\n    ret\n\n.method public static void nada()');
    });

    it('Funcao numero aceita argumentos inteiros com promoção', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'funcao media(a: numero, b: numero): numero { retorna a + b }',
            'escreva(media(1, 2))',
        ]);

        expect(resultado).toContain('.method public static float64 media(float64 a, float64 b) cil managed');
        expect(resultado).toContain('conv.r8');
        expect(resultado).toContain('call float64 Programa::media(float64, float64)');
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(float64)');
    });

    it('Funcao aninhada falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'funcao externa(a: inteiro): inteiro {',
                '  funcao interna(b: inteiro): inteiro { retorna b }',
                '  retorna interna(a)',
                '}',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Retorna sem valor em função não-vazia falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar(['funcao soma(a: inteiro, b: inteiro): inteiro { retorna }'])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Retorna com tipo incompatível falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar(['funcao soma(): inteiro { retorna "texto" }'])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Chamada com tipo de argumento incompatível falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'funcao soma(a: inteiro, b: inteiro): inteiro { retorna a + b }',
                'escreva(soma("1", 2))',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Vetor literal compila para List com leituras por índice', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var itens = [1, 2, 3]',
            'escreva(itens[1])',
        ]);

        expect(resultado).toContain('System.Collections.Generic.List`1<int32>');
        expect(resultado).toContain('newobj instance void class [mscorlib]System.Collections.Generic.List`1<int32>::.ctor()');
        expect(resultado).toContain('callvirt instance void class [mscorlib]System.Collections.Generic.List`1<int32>::Add(int32)');
        expect(resultado).toContain('callvirt instance int32 class [mscorlib]System.Collections.Generic.List`1<int32>::get_Item(int32)');
    });

    it('Atribuição por índice em vetor atualiza elemento', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var itens = [1, 2, 3]',
            'itens[1] = 9',
            'escreva(itens[1])',
        ]);

        expect(resultado).toContain('callvirt instance void class [mscorlib]System.Collections.Generic.List`1<int32>::set_Item(int32, int32)');
        expect(resultado).toContain('ldc.i4 9');
    });

    it('Atribuição de tipo incompatível em vetor falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar(['var itens = [1, 2, 3]', 'itens[1] = "texto"'])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Nao lógico inverte condição booleana', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar(['se (nao falso) { escreva(7) }']);

        expect(resultado).toContain('ldc.i4.0');
        expect(resultado).toContain('ceq');
        expect(resultado).toContain('ldc.i4 7');
    });
});