/// <reference types="jest" />
import { CompiladorDotnet } from '../fontes/compilador-dotnet';

describe('CompiladorDotnet - Base', () => {
    it('Trivial', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar(['']);
        expect(resultado).toBeTruthy();
        expect(resultado).toContain('.method public static void Main() cil managed');
        expect(resultado).toContain('.entrypoint');
    });

    it('Escreva com inteiro', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar(['escreva(123)']);
        expect(resultado).toContain('ldc.i4 123');
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(int32)');
    });

    it('Escreva com numero', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar(['escreva(1.5)']);
        expect(resultado).toContain('ldc.r8 1.5');
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(float64)');
    });

    it('Escreva com texto', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar(['escreva("teste")']);
        expect(resultado).toContain('ldstr "teste"');
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(string)');
    });

    it('Escreva com logico', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar(['escreva(verdadeiro)']);
        expect(resultado).toContain('ldc.i4.1');
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(bool)');
    });
});
