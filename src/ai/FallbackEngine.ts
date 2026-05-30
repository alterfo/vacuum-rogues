export interface FallbackEngine<Input, Output> {
  readonly name: string;
  process(input: Input): Output | Promise<Output>;
}
