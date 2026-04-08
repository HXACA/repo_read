export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function add(a: number, b: number): number {
  return a + b;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(greet("World"));
}
