/// <reference types="jest" />
import { CompiladorDotnet } from '../fontes/compilador-dotnet';

describe('CompiladorDotnet - Aritmética', () => {
    it('Soma de inteiros permanece inteira', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar(['escreva(1 + 2)']);
        expect(resultado).toContain('ldc.i4 1');
        expect(resultado).toContain('ldc.i4 2');
        expect(resultado).toContain('add');
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(int32)');
    });

    it('Mistura de inteiro e numero promove para float64', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar(['escreva(1 + 2.5)']);
        expect(resultado).toContain('ldc.i4 1');
        expect(resultado).toContain('conv.r8');
        expect(resultado).toContain('ldc.r8 2.5');
        expect(resultado).toContain('add');
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(float64)');
    });

    it('Divisão sempre produz numero, mesmo entre inteiros', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar(['escreva(5 / 2)']);
        expect(resultado).toContain('conv.r8');
        expect(resultado).toContain('div');
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(float64)');
    });

    it('Expressão com agrupamento', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar(['escreva((1 + 2) * 3)']);
        expect(resultado).toContain('add');
        expect(resultado).toContain('mul');
    });
});
