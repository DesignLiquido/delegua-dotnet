export class ErroCompilador extends Error {
    linha?: number;
    coluna?: number;

    constructor(mensagem: string) {
        super(mensagem);
        this.name = 'ErroCompilador';
    }
}
