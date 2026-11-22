/** A number with its noun: "1 entry", "3 entries". `many` is the noun with an s unless given. */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
