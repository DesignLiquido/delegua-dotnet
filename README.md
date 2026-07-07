# delegua-dotnet

Back-end para geração de código Delégua em .NET.

## Arquitetura

Segue a mesma arquitetura de [`delegua-llvm`](https://github.com/DesignLiquido/delegua-llvm): reaproveita o `Lexador` e o `AvaliadorSintatico` de [`@designliquido/delegua`](https://github.com/DesignLiquido/delegua) e implementa `VisitanteDeleguaInterface` para percorrer a AST diretamente. Ao invés de gerar LLVM IR, este compilador gera **CIL (Common Intermediate Language)** em formato texto, que é então montado por `ilasm`.

Diferente de `delegua-llvm` (que usa bindings nativos do LLVM), este back-end usa **emissão textual**, no mesmo espírito dos `Tradutor*` de assembly (`tradutor-assembly-x64.ts`, `tradutor-webassembly.ts`) já existentes no repositório principal `delegua`.

## Estado atual

Suporta apenas:

- `var` com literais (`inteiro`, `numero`, `texto`, `logico`);
- leitura de variáveis já declaradas;
- aritmética (`+ - * /`) entre `inteiro`/`numero`, com promoção para `float64` quando misturados (divisão sempre produz `numero`, mesmo entre inteiros);
- comparações (`< <= > >= == !=`) entre valores primitivos suportados;
- atribuição local (`x = ...`);
- `se`/`senao`;
- `enquanto`;
- `para`;
- `escolha`/`caso`/`padrao`;
- `continua` e `sustar` dentro de laços;
- funções de topo com parâmetros tipados, sem parâmetros, retorno `vazio`, `retorna`, recursão e chamadas entre funções;
- vetores homogêneos com literais, leitura por índice e atribuição por índice;
- dicionários com chaves de texto, valores homogêneos, leitura por chave e atribuição por chave;
- operadores lógicos `e`, `ou` e `nao` no subconjunto booleano;
- `escreva(...)` com os tipos acima.

Todo o restante da gramática (classes, `importar`, exceções, closures, FFI) ainda **não é suportado** e lança `ErroCompilador` — ver `fontes/visitante-base-nao-implementado.ts`.

## Mapeamento de tipos (nesta versão)

| Delégua    | CIL        |
|------------|------------|
| `inteiro`  | `int32`    |
| `numero`   | `float64`  |
| `logico`   | `bool`     |
| `texto`    | `string`   |

Os tipos são fixos e estaticamente tipados no código gerado — não há BigInt/precisão arbitrária como no interpretador dinâmico (mesma divergência deliberada adotada por `delegua-llvm`).

## Uso

```bash
yarn executar caminho/para/arquivo.delegua
```

Gera um `.il` ao lado do arquivo de entrada. Se `ilasm` estiver disponível no `PATH`, também monta um `.exe`.

## Pré-requisitos de toolchain

- [.NET SDK](https://dotnet.microsoft.com/) instalado (`dotnet --version`).
- `ilasm`: **não** é incluído por padrão no SDK do .NET moderno (Core/5+). Para obtê-lo:
  1. Crie um projeto de scratch referenciando o pacote NuGet `runtime.win-x64.Microsoft.NETCore.ILAsm` (ou a variante do seu sistema operacional);
  2. Restaure (`dotnet restore`) e localize o binário `ilasm` dentro do cache de pacotes NuGet;
  3. Adicione-o ao `PATH`.

## Testes

```bash
yarn testes-unitarios
```

Os testes verificam o texto CIL gerado diretamente (sem precisar de `ilasm` instalado), no mesmo estilo de `delegua-llvm/testes/compilador-llvm.base.test.ts`.
