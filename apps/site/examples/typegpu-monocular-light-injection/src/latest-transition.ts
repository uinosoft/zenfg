export interface TransitionToken<T> {
    readonly generation: number;
    readonly target: T;
}

export class LatestTransition<T> {
    private generation = 0;

    constructor(private committedValue: T) {}

    get committed(): T {
        return this.committedValue;
    }

    begin(target: T): TransitionToken<T> {
        return { generation: ++this.generation, target };
    }

    isCurrent(token: TransitionToken<T>): boolean {
        return token.generation === this.generation;
    }

    commit(token: TransitionToken<T>): boolean {
        if (!this.isCurrent(token)) return false;
        this.committedValue = token.target;
        return true;
    }

    invalidate(): void {
        this.generation += 1;
    }
}
