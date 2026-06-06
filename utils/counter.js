let roundCounter = 0;

export function roundCounterNext() {
    return roundCounter++;
}

export function roundCounterReset() {
    roundCounter = 0;
}

let promptCounter = 0;

export function promptCounterNext() {
    return promptCounter++;
}

export function promptCounterReset() {
    promptCounter = 0;
}
