# delegua-dotnet

Back-end para geração de código Delégua em .NET.

## Arquitetura

Segue a mesma arquitetura de [`delegua-llvm`](https://github.com/DesignLiquido/delegua-llvm): reaproveita o `Lexador` e o `AvaliadorSintatico` de [`@designliquido/delegua`](https://github.com/DesignLiquido/delegua) e implementa `VisitanteDeleguaInterface` para percorrer a AST diretamente. Ao invés de gerar LLVM IR, este compilador gera **CIL (Common Intermediate Language)** em formato texto, que é então montado por `ilasm`.

Diferente de `delegua-llvm` (que usa bindings nativos do LLVM), este back-end usa **emissão textual**, no mesmo espírito dos `Tradutor*` de assembly (`tradutor-assembly-x64.ts`, `tradutor-webassembly.ts`) já existentes no repositório principal `delegua`.

## Estado atual

Suporta apenas:


  - Declaração de `classe` com métodos de instância.
  - `construtor(...)` com criação via chamada da classe (`Pessoa("Ada")`).
  - `isto` e atribuição/acesso de campos via `isto.campo` e `objeto.campo`.
  - Chamada de método de instância (`objeto.metodo(...)`).

## Mapeamento de tipos (nesta versão)

| Delégua    | CIL        |
|------------|------------|
| `inteiro`  | `int32`    |
| `numero`   | `float64`  |
| `logico`   | `bool`     |
| `texto`    | `string`   |

Os tipos são fixos e estaticamente tipados no código gerado — não há BigInt/precisão arbitrária como no interpretador dinâmico (mesma divergência deliberada adotada por `delegua-llvm`).


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
