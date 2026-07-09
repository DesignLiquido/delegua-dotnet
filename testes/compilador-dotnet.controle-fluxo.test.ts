/// <reference types="jest" />
import { FormatacaoEscrita, Literal } from '@designliquido/delegua';
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

    it('Funcao recursiva pode chamar a si mesma', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'funcao fib(n: inteiro): inteiro { se (n <= 1) { retorna n } retorna fib(n - 1) + fib(n - 2) }',
            'escreva(fib(3))',
        ]);

        expect(resultado).toContain('.method public static int32 fib(int32 n) cil managed');
        expect(resultado.match(/call int32 Programa::fib\(int32\)/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('Funções podem encadear chamadas entre si', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'funcao dobro(x: inteiro): inteiro { retorna x + x }',
            'funcao somaDobro(x: inteiro): inteiro { retorna dobro(x) + dobro(x) }',
            'escreva(somaDobro(2))',
        ]);

        expect(resultado).toContain('.method public static int32 dobro(int32 x) cil managed');
        expect(resultado).toContain('.method public static int32 somaDobro(int32 x) cil managed');
        expect(resultado.match(/call int32 Programa::dobro\(int32\)/g)?.length).toBeGreaterThanOrEqual(2);
        expect(resultado).toContain('call int32 Programa::somaDobro(int32)');
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

    it('Vetor numérico misto promove para float64', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var numeros = [1, 2.5, 3]',
            'escreva(numeros[1])',
        ]);

        expect(resultado).toContain('System.Collections.Generic.List`1<float64>');
        expect(resultado).toContain('conv.r8');
        expect(resultado).toContain('callvirt instance float64 class [mscorlib]System.Collections.Generic.List`1<float64>::get_Item(int32)');
    });

    it('Vetor de textos compila', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var textos = ["a", "b"]',
            'escreva(textos[1])',
        ]);

        expect(resultado).toContain('System.Collections.Generic.List`1<string>');
        expect(resultado).toContain('callvirt instance string class [mscorlib]System.Collections.Generic.List`1<string>::get_Item(int32)');
    });

    it('Vetor de lógicos compila', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var logicos = [verdadeiro, falso]',
            'escreva(logicos[0])',
        ]);

        expect(resultado).toContain('System.Collections.Generic.List`1<bool>');
        expect(resultado).toContain('callvirt instance bool class [mscorlib]System.Collections.Generic.List`1<bool>::get_Item(int32)');
    });

    it('Tamanho de vetor funciona como método e propriedade', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var v = [1, 2, 3]',
            'escreva(v.tamanho())',
            'escreva(v.tamanho)',
        ]);

        expect(resultado.match(/get_Count\(\)/g)?.length).toBeGreaterThanOrEqual(2);
        expect(resultado.match(/WriteLine\(int32\)/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('Adicionar em vetor chama Add e preserva a coleção', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var v = [1, 2]',
            'v.adicionar(3)',
            'escreva(v.tamanho())',
        ]);

        expect(resultado).toContain('callvirt instance void class [mscorlib]System.Collections.Generic.List`1<int32>::Add(int32)');
        expect(resultado).toContain('dup');
    });

    it('Valores de vetor retornam a própria coleção', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var v = [1, 2]',
            'escreva(v.valores().tamanho())',
        ]);

        expect(resultado).toContain('List`1<int32>::get_Count()');
    });

    it('Dicionário literal compila para Dictionary com leitura por chave', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var mapa = { "a": 1, "b": 2 }',
            'escreva(mapa["b"])',
        ]);

        expect(resultado).toContain('System.Collections.Generic.Dictionary`2<string, int32>');
        expect(resultado).toContain('newobj instance void class [mscorlib]System.Collections.Generic.Dictionary`2<string, int32>::.ctor()');
        expect(resultado).toContain('callvirt instance void class [mscorlib]System.Collections.Generic.Dictionary`2<string, int32>::Add(string, int32)');
        expect(resultado).toContain('callvirt instance int32 class [mscorlib]System.Collections.Generic.Dictionary`2<string, int32>::get_Item(string)');
    });

    it('Tupla literal de inteiros compila para array fixo', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = (1, 2, 3)',
            'escreva(t)',
        ]);

        expect(resultado).toContain('.locals init (int32[] V_0)');
        expect(resultado).toContain('newarr int32');
        expect(resultado).toContain('stelem.i4');
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(object)');
    });

    it('Tupla numérica mista promove para float64[]', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = (1, 2.5)',
            'escreva(t)',
        ]);

        expect(resultado).toContain('.locals init (float64[] V_0)');
        expect(resultado).toContain('newarr float64');
        expect(resultado).toContain('conv.r8');
        expect(resultado).toContain('stelem.r8');
    });

    it('Acesso por índice em tupla carrega elemento', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = (1, 2, 3)',
            'escreva(t[1])',
        ]);

        expect(resultado).toContain('ldelem.i4');
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(int32)');
    });

    it('Tamanho de tupla funciona como método e propriedade', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = (1, 2, 3)',
            'escreva(t.tamanho())',
            'escreva(t.tamanho)',
        ]);

        expect(resultado.match(/ldlen/g)?.length).toBeGreaterThanOrEqual(2);
        expect(resultado.match(/conv\.i4/g)?.length).toBeGreaterThanOrEqual(2);
        expect(resultado.match(/WriteLine\(int32\)/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('Atribuição por índice em tupla atualiza elemento', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = (1, 2, 3)',
            't[1] = 9',
            'escreva(t[1])',
        ]);

        expect(resultado).toContain('stelem.i4');
        expect(resultado).toContain('ldc.i4 9');
    });

    it('Atribuição de tipo incompatível em tupla falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'var t = (1, 2, 3)',
                't[1] = "texto"',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Tupla com tipos incompatíveis falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'var t = (1, "a")',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Dicionário com chaves inteiras compila', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var mapa = { 1: "a", 2: "b" }',
            'escreva(mapa[2])',
        ]);

        expect(resultado).toContain('System.Collections.Generic.Dictionary`2<int32, string>');
        expect(resultado).toContain('callvirt instance void class [mscorlib]System.Collections.Generic.Dictionary`2<int32, string>::Add(int32, string)');
        expect(resultado).toContain('callvirt instance string class [mscorlib]System.Collections.Generic.Dictionary`2<int32, string>::get_Item(int32)');
    });

    it('Dicionário com chaves lógicas compila', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var mapa = { verdadeiro: 1, falso: 2 }',
            'escreva(mapa[verdadeiro])',
        ]);

        expect(resultado).toContain('System.Collections.Generic.Dictionary`2<bool, int32>');
        expect(resultado).toContain('callvirt instance void class [mscorlib]System.Collections.Generic.Dictionary`2<bool, int32>::Add(bool, int32)');
        expect(resultado).toContain('callvirt instance int32 class [mscorlib]System.Collections.Generic.Dictionary`2<bool, int32>::get_Item(bool)');
    });

    it('Tamanho de dicionário funciona como método e propriedade', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var mapa = { "a": 1, "b": 2 }',
            'escreva(mapa.tamanho())',
            'escreva(mapa.tamanho)',
        ]);

        expect(resultado.match(/Dictionary`2<string, int32>::get_Count\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('Chaves de dicionário retornam vetor do tipo da chave', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var mapa = { "a": 1, "b": 2 }',
            'escreva(mapa.chaves().tamanho())',
        ]);

        expect(resultado).toContain('Dictionary`2<string, int32>::get_Keys()');
        expect(resultado).toContain('List`1<string>::.ctor(class [mscorlib]System.Collections.Generic.IEnumerable`1<string>)');
    });

    it('Valores de dicionário retornam vetor do tipo do valor', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var mapa = { "a": 1, "b": 2 }',
            'escreva(mapa.valores().tamanho())',
        ]);

        expect(resultado).toContain('Dictionary`2<string, int32>::get_Values()');
        expect(resultado).toContain('List`1<int32>::.ctor(class [mscorlib]System.Collections.Generic.IEnumerable`1<int32>)');
    });

    it('Atribuição por chave em dicionário atualiza valor', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var mapa = { "a": 1, "b": 2 }',
            'mapa["b"] = 9',
            'escreva(mapa["b"])',
        ]);

        expect(resultado).toContain('callvirt instance void class [mscorlib]System.Collections.Generic.Dictionary`2<string, int32>::set_Item(string, int32)');
        expect(resultado).toContain('ldstr "b"');
        expect(resultado).toContain('ldc.i4 9');
    });

    it('Atribuição de tipo incompatível em dicionário falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar(['var mapa = { "a": 1 }', 'mapa["a"] = "texto"'])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Texto maiusculo e minusculo compilam para ToUpper/ToLower', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = "DeLeGuA"',
            'escreva(t.maiusculo())',
            'escreva(t.minusculo())',
        ]);

        expect(resultado).toContain('callvirt instance string [mscorlib]System.String::ToUpper()');
        expect(resultado).toContain('callvirt instance string [mscorlib]System.String::ToLower()');
        expect(resultado.match(/WriteLine\(string\)/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('Texto substituir compila para String.Replace', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = "Delegua"',
            'escreva(t.substituir("gua", "dotnet"))',
        ]);

        expect(resultado).toContain('callvirt instance string [mscorlib]System.String::Replace(string, string)');
    });

    it('Texto divida compila para String.Split e retorna array de texto', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = "a,b,c"',
            'escreva(t.divida(",")[1])',
        ]);

        expect(resultado).toContain('callvirt instance string[] [mscorlib]System.String::Split(char[])');
        expect(resultado).toContain('ldelem.ref');
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(string)');
    });

    it('Texto substituir com argumentos não-texto falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'var t = "Delegua"',
                'escreva(t.substituir(1, "x"))',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('FormatacaoEscrita aplica casas decimais e espaços', async () => {
        const compilador: any = new CompiladorDotnet();
        compilador.instrucoes = [];
        compilador.variaveis = new Map();
        compilador.locaisTemporarios = [];
        compilador.proximoIndiceLocal = 0;
        compilador.proximoRotulo = 0;
        compilador.pilhaRotulosLoop = [];
        compilador.funcoes = new Map();
        compilador.classes = new Map();
        compilador.metodosCompilados = [];
        compilador.classesCompiladas = [];
        compilador.funcaoAtual = null;
        compilador.classeAtual = null;
        compilador.metodoClasseAtual = null;

        const expressao = new FormatacaoEscrita(-1, 1, new Literal(-1, 1, 12.345, 'número'), 2, 2);
        const tipo = await compilador.visitarExpressaoFormatacaoEscrita(expressao);

        expect(tipo).toBe('texto');
        const il = compilador.instrucoes.join('\n');
        expect(il).toContain('ldstr "F2"');
        expect(il).toContain('System.Double::ToString(string)');
        expect(il).toContain('ldstr "  "');
        expect(il).toContain('System.String::Concat(string, string)');
    });

    it('Tamanho de texto funciona como método e propriedade', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = "abc"',
            'escreva(t.tamanho())',
            'escreva(t.tamanho)',
        ]);

        expect(resultado.match(/System\.String::get_Length\(\)/g)?.length).toBeGreaterThanOrEqual(2);
        expect(resultado.match(/WriteLine\(int32\)/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('Texto contem/iniciaCom/terminaCom compilam para bool', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = "Delegua"',
            'escreva(t.contem("leg"))',
            'escreva(t.iniciaCom("De"))',
            'escreva(t.terminaCom("gua"))',
        ]);

        expect(resultado).toContain('callvirt instance bool [mscorlib]System.String::Contains(string)');
        expect(resultado).toContain('callvirt instance bool [mscorlib]System.String::StartsWith(string)');
        expect(resultado).toContain('callvirt instance bool [mscorlib]System.String::EndsWith(string)');
        expect(resultado.match(/WriteLine\(bool\)/g)?.length).toBeGreaterThanOrEqual(3);
    });

    it('Texto inclui compila como alias de Contains', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = "Delegua"',
            'escreva(t.inclui("leg"))',
        ]);

        expect(resultado).toContain('callvirt instance bool [mscorlib]System.String::Contains(string)');
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(bool)');
    });

    it('Texto encontrar compila para String.IndexOf com e sem índice inicial', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = "abcabc"',
            'escreva(t.encontrar("bc"))',
            'escreva(t.encontrar("bc", 3))',
        ]);

        expect(resultado).toContain('callvirt instance int32 [mscorlib]System.String::IndexOf(string)');
        expect(resultado).toContain('callvirt instance int32 [mscorlib]System.String::IndexOf(string, int32)');
        expect(resultado.match(/WriteLine\(int32\)/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('Texto dividir aceita delimitador e limite opcional', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = "a,b,c"',
            'escreva(t.dividir(",")[1])',
            'escreva(t.dividir(",", 2)[1])',
        ]);

        expect(resultado).toContain('callvirt instance string[] [mscorlib]System.String::Split(char[])');
        expect(resultado).toContain('callvirt instance string[] [mscorlib]System.String::Split(char[], int32)');
        expect(resultado.match(/ldelem\.ref/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('Texto apararInicio e apararFim compilam para TrimStart/TrimEnd', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = "  Delegua  "',
            'escreva(t.apararInicio())',
            'escreva(t.apararFim())',
        ]);

        expect(resultado).toContain('callvirt instance string [mscorlib]System.String::TrimStart()');
        expect(resultado).toContain('callvirt instance string [mscorlib]System.String::TrimEnd()');
    });

    it('Texto concatenar compila para String.Concat em cadeia', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = "ab"',
            'escreva(t.concatenar("cd", "ef"))',
        ]);

        expect(resultado.match(/System\.String::Concat\(string, string\)/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('Texto fatiar e subtexto compilam para Substring', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = "abcdef"',
            'escreva(t.fatiar(1, 4))',
            'escreva(t.subtexto(2, 5))',
        ]);

        expect(resultado.match(/System\.String::Substring\(int32, int32\)/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('Texto inverter compila para reverse de char array e novo string', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = "abc"',
            'escreva(t.inverter())',
        ]);

        expect(resultado).toContain('callvirt instance char[] [mscorlib]System.String::ToCharArray()');
        expect(resultado).toContain('call void [mscorlib]System.Array::Reverse(class [mscorlib]System.Array)');
        expect(resultado).toContain('newobj instance void [mscorlib]System.String::.ctor(char[])');
    });

    it('Texto tudoMaiusculo e tudoMinusculo compilam para comparação com ToUpper/ToLower', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var a = "ABC"',
            'var b = "abc"',
            'escreva(a.tudoMaiusculo())',
            'escreva(b.tudoMinusculo())',
        ]);

        expect(resultado).toContain('callvirt instance string [mscorlib]System.String::ToUpper()');
        expect(resultado).toContain('callvirt instance string [mscorlib]System.String::ToLower()');
        expect(resultado).toContain('call bool [mscorlib]System.String::op_Equality(string, string)');
    });

    it('Texto particao e partição retornam três partes indexáveis', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = "a,b,c"',
            'escreva(t.particao(",")[1])',
            'escreva(t.partição(",")[2])',
        ]);

        expect(resultado).toContain('newarr string');
        expect(resultado).toContain('System.String::IndexOf(string)');
        expect(resultado.match(/stelem\.ref/g)?.length).toBeGreaterThanOrEqual(6);
        expect(resultado.match(/ldelem\.ref/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('Texto encontrar com índice não inteiro falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'var t = "abcabc"',
                'escreva(t.encontrar("bc", 1.5))',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Texto aparar compila para String.Trim', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'var t = "  Delegua  "',
            'escreva(t.aparar())',
        ]);

        expect(resultado).toContain('callvirt instance string [mscorlib]System.String::Trim()');
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(string)');
    });

    it('Texto contem com argumento não-texto falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'var t = "Delegua"',
                'escreva(t.contem(1))',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Tente com falhar e pegue compila para try/catch', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'tente { falhar("erro") } pegue { escreva("recuperado") }',
        ]);

        expect(resultado).toContain('.try');
        expect(resultado).toContain('newobj instance void [mscorlib]System.Exception::.ctor(string)');
        expect(resultado).toContain('throw');
        expect(resultado).toContain('catch [mscorlib]System.Exception');
        expect(resultado).toContain('ldstr "recuperado"');
    });

    it('Tente com finalmente compila para bloco finally', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'tente { falhar("erro") } pegue { escreva("recuperado") } finalmente { escreva("fim") }',
        ]);

        expect(resultado).toContain('finally');
        expect(resultado).toContain('endfinally');
        expect(resultado).toContain('ldstr "fim"');
    });

    it('Falhar com explicação não-texto falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'falhar(1)',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Classe com construtor e método de instância compila', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'classe Pessoa {',
            '  construtor(nome: texto) { isto.nome = nome }',
            '  falar(): texto { retorna isto.nome }',
            '}',
            'var p = Pessoa("Ada")',
            'escreva(p.falar())',
        ]);

        expect(resultado).toContain('.class public auto ansi beforefieldinit Pessoa');
        expect(resultado).toContain('.field public string nome');
        expect(resultado).toContain('.method public hidebysig specialname rtspecialname instance void .ctor(string nome) cil managed');
        expect(resultado).toContain('newobj instance void class Pessoa::.ctor(string)');
        expect(resultado).toContain('callvirt instance string class Pessoa::falar()');
    });

    it('Classe com propriedade declarada tipada compila campo e acesso', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'classe Pessoa {',
            '  nome: texto',
            '  construtor(nome: texto) { isto.nome = nome }',
            '}',
            'var p = Pessoa("Ada")',
            'escreva(p.nome)',
        ]);

        expect(resultado).toContain('.field public string nome');
        expect(resultado).toContain('newobj instance void class Pessoa::.ctor(string)');
        expect(resultado).toContain('ldfld string class Pessoa::nome');
    });

    it('Método de instância aceita parâmetros tipados', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'classe Pessoa {',
            '  construtor(nome: texto) { isto.nome = nome }',
            '  falarCom(sufixo: texto): texto { retorna sufixo }',
            '}',
            'var p = Pessoa("Ada")',
            'escreva(p.falarCom("!"))',
        ]);

        expect(resultado).toContain('.method public hidebysig instance string falarCom(string sufixo) cil managed');
        expect(resultado).toContain('callvirt instance string class Pessoa::falarCom(string)');
    });

    it('Acesso a propriedade inexistente em classe falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'classe Pessoa {',
                '  construtor(nome: texto) { isto.nome = nome }',
                '}',
                'var p = Pessoa("Ada")',
                'escreva(p.sobrenome)',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Construtor com aridade inválida falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'classe Pessoa {',
                '  construtor(nome: texto) { isto.nome = nome }',
                '}',
                'var p = Pessoa()',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Construtor com tipo de argumento inválido falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'classe Pessoa {',
                '  construtor(nome: texto) { isto.nome = nome }',
                '}',
                'var p = Pessoa(1)',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Método de instância com aridade inválida falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'classe Pessoa {',
                '  construtor(nome: texto) { isto.nome = nome }',
                '  falarCom(sufixo: texto): texto { retorna sufixo }',
                '}',
                'var p = Pessoa("Ada")',
                'escreva(p.falarCom())',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Método de instância com tipo de argumento inválido falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'classe Pessoa {',
                '  construtor(nome: texto) { isto.nome = nome }',
                '  falarCom(sufixo: texto): texto { retorna sufixo }',
                '}',
                'var p = Pessoa("Ada")',
                'escreva(p.falarCom(1))',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Reatribuição de campo com tipo incompatível falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'classe Pessoa {',
                '  construtor(nome: texto) { isto.nome = nome }',
                '  quebrar(): vazio { isto.nome = 1 }',
                '}',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Classe sem construtor explícito gera construtor padrão', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'classe Vazia {}',
            'var v = Vazia()',
        ]);

        expect(resultado).toContain('.method public hidebysig specialname rtspecialname instance void .ctor() cil managed');
        expect(resultado).toContain('call instance void [mscorlib]System.Object::.ctor()');
        expect(resultado).toContain('newobj instance void class Vazia::.ctor()');
    });

    it('Herança simples permite chamar método da classe base', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'classe Base {',
            '  construtor() {}',
            '  falar(): texto { retorna "ok" }',
            '}',
            'classe Derivada herda Base {}',
            'var d = Derivada()',
            'escreva(d.falar())',
        ]);

        expect(resultado).toContain('.class public auto ansi beforefieldinit Derivada');
        expect(resultado).toContain('extends class Base');
        expect(resultado).toContain('newobj instance void class Derivada::.ctor()');
        expect(resultado).toContain('callvirt instance string class Base::falar()');
    });

    it('super.falar() resolve chamada para implementação da classe base', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'classe Base {',
            '  construtor() {}',
            '  valor(): inteiro { retorna 1 }',
            '}',
            'classe Derivada herda Base {',
            '  valor(): inteiro { retorna 2 }',
            '  valorBase(): inteiro { retorna super.valor() }',
            '}',
            'var d = Derivada()',
            'escreva(d.valorBase())',
        ]);

        expect(resultado).toContain('callvirt instance int32 class Base::valor()');
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(int32)');
    });

    it('super().metodo() funciona como alias para instância base tipada', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar([
            'classe Base {',
            '  construtor() {}',
            '  valor(): inteiro { retorna 7 }',
            '}',
            'classe Derivada herda Base {',
            '  valorBase(): inteiro { retorna super().valor() }',
            '}',
            'var d = Derivada()',
            'escreva(d.valorBase())',
        ]);

        expect(resultado).toContain('callvirt instance int32 class Base::valor()');
    });

    it('Uso de super() com argumentos falha na compilação', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'classe Base {',
                '  construtor() {}',
                '  valor(): inteiro { retorna 1 }',
                '}',
                'classe Derivada herda Base {',
                '  valorBase(): inteiro { retorna super(1).valor() }',
                '}',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Herança com construtor da base com parâmetros falha nesta fase', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'classe Base {',
                '  construtor(nome: texto) { isto.nome = nome }',
                '}',
                'classe Derivada herda Base {}',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Implementação de interface ainda não é suportada', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'interface ITeste {}',
                'classe Pessoa implementa ITeste {}',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Classe abstrata ainda não é suportada', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'classe abstrata Pessoa {}',
            ])
        ).rejects.toThrow(ErroCompilador);
    });

    it('Classe estatica ainda não é suportada', async () => {
        const compilador = new CompiladorDotnet();

        await expect(
            compilador.compilar([
                'classe estatica Util {}',
            ])
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