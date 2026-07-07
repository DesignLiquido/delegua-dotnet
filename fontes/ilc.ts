#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

import { CompiladorDotnet } from './compilador-dotnet';
import { ErroCompilador } from './erros/erro-compilador';

function obterVersaoRuntimeInstalada(): string {
    const saida = execSync('dotnet --list-runtimes', { stdio: 'pipe' }).toString();
    const correspondencia = saida.match(/Microsoft\.NETCore\.App (\d+\.\d+\.\d+)/);
    return correspondencia ? correspondencia[1] : '9.0.0';
}

function verificarIlasmDisponivel(): boolean {
    try {
        execSync('where ilasm', { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

async function principal() {
    const args = process.argv.slice(2);
    const arquivoEntrada = args[0];

    if (!arquivoEntrada || !fs.existsSync(arquivoEntrada)) {
        console.log('Uso: npx @designliquido/delegua-dotnet <arquivo.delegua>');
        process.exit(1);
    }

    const conteudo = fs.readFileSync(arquivoEntrada, 'utf-8');
    const codigo = conteudo.split('\n');
    const nomeBase = path.basename(arquivoEntrada, path.extname(arquivoEntrada));
    const diretorioSaida = path.dirname(arquivoEntrada);
    const caminhoIl = path.join(diretorioSaida, `${nomeBase}.il`);
    const caminhoExe = path.join(diretorioSaida, `${nomeBase}.exe`);
    const caminhoRuntimeConfig = path.join(diretorioSaida, `${nomeBase}.runtimeconfig.json`);

    const compilador = new CompiladorDotnet();

    try {
        console.log('Gerando CIL...');
        const cil = await compilador.compilar(codigo);
        fs.writeFileSync(caminhoIl, cil);
        console.log(`CIL gerado: ${caminhoIl}`);

        if (!verificarIlasmDisponivel()) {
            console.log('');
            console.log('Aviso: "ilasm" não foi encontrado no PATH. O arquivo .il foi gerado,');
            console.log('mas não foi montado em um executável.');
            console.log('');
            console.log('Para obter o ilasm em .NET moderno, restaure o pacote NuGet');
            console.log('"runtime.win-x64.Microsoft.NETCore.ILAsm" (ou a variante do seu SO)');
            console.log('a partir de um projeto de scratch e adicione o binário resultante ao PATH.');
            return;
        }

        console.log('Montando executável...');
        execSync(`ilasm "${caminhoIl}" /output="${caminhoExe}"`, { stdio: 'inherit' });

        // .NET moderno (Core/5+) precisa de um .runtimeconfig.json ao lado do
        // executável para saber qual versão do runtime carregar; `ilasm` não gera isso.
        const versaoRuntime = obterVersaoRuntimeInstalada();
        fs.writeFileSync(
            caminhoRuntimeConfig,
            JSON.stringify(
                {
                    runtimeOptions: {
                        tfm: `net${versaoRuntime.split('.').slice(0, 2).join('.')}`,
                        framework: { name: 'Microsoft.NETCore.App', version: versaoRuntime },
                    },
                },
                null,
                2
            )
        );

        console.log(`Executável gerado: ${caminhoExe}`);
        console.log(`Para executar: dotnet ${path.relative('.', caminhoExe)}`);
    } catch (erro: any) {
        if (erro instanceof ErroCompilador) {
            console.error(`erro: ${erro.message}`);
        } else {
            console.error('Erro interno durante compilação:');
            console.error(erro.message || erro);
        }
        process.exit(1);
    }
}

principal();
