export class Queue<T> {
    _store: T[] = [];
    push(val: T) {
        this._store.push(val);
    }

    pop(): T | undefined {
        return this._store.shift();
    }

    isEmpty() : boolean {
        return this._store.length == 0;
    }
}

export class Stack<T> {
    _store: T[] = [];
    push(val: T) {
        this._store.push(val);
    }

    pop(): T | undefined {
        return this._store.pop();
    }

    isEmpty() : boolean {
        return this._store.length == 0;
    }
}
