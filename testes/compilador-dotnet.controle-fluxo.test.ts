/// <reference types="jest" />
import { CompiladorDotnet } from '../fontes/compilador-dotnet';

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

    it('Nao lógico inverte condição booleana', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar(['se (nao falso) { escreva(7) }']);

        expect(resultado).toContain('ldc.i4.0');
        expect(resultado).toContain('ceq');
        expect(resultado).toContain('ldc.i4 7');
    });
});