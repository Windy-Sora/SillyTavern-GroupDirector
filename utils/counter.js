let roundCounter = 0;
let roundCounterSnapshot = 0;

export function roundCounterNext() {
    return roundCounter++;
}

export function roundCounterReset() {
    roundCounter = 0;
    roundCounterSnapshot = 0;
}

export function roundCounterSnapshotSave() {
    roundCounterSnapshot = roundCounter;
}

export function roundCounterSnapshotRestore() {
    roundCounter = roundCounterSnapshot;
}

let promptCounter = 0;

export function promptCounterNext() {
    return promptCounter++;
}

export function promptCounterReset() {
    promptCounter = 0;
}
