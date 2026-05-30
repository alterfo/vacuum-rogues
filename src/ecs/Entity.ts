export interface Entity {
  readonly id: string;
  [component: string]: unknown;
}
