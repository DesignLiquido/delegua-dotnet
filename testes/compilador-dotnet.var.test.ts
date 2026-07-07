/// <reference types="jest" />
import { CompiladorDotnet } from '../fontes/compilador-dotnet';

describe('CompiladorDotnet - Var', () => {
    it('Var inteiro', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar(['var x = 10']);
        expect(resultado).toContain('.locals init (int32 V_0)');
        expect(resultado).toContain('ldc.i4 10');
        expect(resultado).toContain('stloc 0');
    });

    it('Var numero', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar(['var x = 3.14']);
        expect(resultado).toContain('.locals init (float64 V_0)');
        expect(resultado).toContain('ldc.r8 3.14');
    });

    it('Var texto', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar(['var x = "ola"']);
        expect(resultado).toContain('.locals init (string V_0)');
        expect(resultado).toContain('ldstr "ola"');
    });

    it('Var logico', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar(['var x = falso']);
        expect(resultado).toContain('.locals init (bool V_0)');
        expect(resultado).toContain('ldc.i4.0');
    });

    it('Leitura de variável em escreva', async () => {
        const compilador = new CompiladorDotnet();
        const resultado = await compilador.compilar(['var x = 10', 'escreva(x)']);
        expect(resultado).toContain('stloc 0');
        expect(resultado).toContain('ldloc 0');
        expect(resultado).toContain('call void [mscorlib]System.Console::WriteLine(int32)');
    });
});
