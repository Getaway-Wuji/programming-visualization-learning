/** P0's finite, serializable block tree. It never contains raw C fragments. */
export interface BlockNode {
  readonly id: string;
}
export interface BlockInteger extends BlockNode {
  readonly kind: 'integer';
  readonly value: string;
}
export interface BlockVariable extends BlockNode {
  readonly kind: 'variable';
  readonly name: string;
}
export interface BlockUnary extends BlockNode {
  readonly kind: 'unary';
  readonly operator: '+' | '-' | '!';
  readonly operand: BlockExpression;
}
export interface BlockArithmetic extends BlockNode {
  readonly kind: 'arithmetic';
  readonly operator: '+' | '-' | '*' | '/' | '%';
  readonly left: BlockExpression;
  readonly right: BlockExpression;
}
export interface BlockCompare extends BlockNode {
  readonly kind: 'compare';
  readonly operator: '<' | '<=' | '>' | '>=' | '==' | '!=';
  readonly left: BlockExpression;
  readonly right: BlockExpression;
}
export interface BlockLogic extends BlockNode {
  readonly kind: 'logic';
  readonly operator: '&&' | '||';
  readonly left: BlockExpression;
  readonly right: BlockExpression;
}
export interface BlockArrayRead extends BlockNode {
  readonly kind: 'array_read';
  readonly name: string;
  readonly index: BlockExpression;
}
export type BlockExpression =
  | BlockInteger
  | BlockVariable
  | BlockUnary
  | BlockArithmetic
  | BlockCompare
  | BlockLogic
  | BlockArrayRead;

export interface BlockInput extends BlockNode {
  readonly kind: 'input';
  readonly bindingKey: string;
  readonly name: string;
  readonly targetKind: 'scalar' | 'array' | 'logical-length';
}
export interface BlockDeclare extends BlockNode {
  readonly kind: 'declare';
  readonly name: string;
  readonly initial: BlockExpression | null;
}
export interface BlockAssign extends BlockNode {
  readonly kind: 'assign';
  readonly name: string;
  readonly value: BlockExpression;
}
export interface BlockIf extends BlockNode {
  readonly kind: 'if';
  readonly condition: BlockExpression;
  readonly then: readonly BlockStatement[];
  readonly else: readonly BlockStatement[] | null;
}
export interface BlockWhile extends BlockNode {
  readonly kind: 'while';
  readonly condition: BlockExpression;
  readonly body: readonly BlockStatement[];
}
export interface BlockFor extends BlockNode {
  readonly kind: 'for';
  readonly init: BlockDeclare | BlockAssign | null;
  readonly condition: BlockExpression | null;
  readonly update: BlockAssign | null;
  readonly body: readonly BlockStatement[];
}
export interface BlockBreak extends BlockNode {
  readonly kind: 'break';
}
export interface BlockContinue extends BlockNode {
  readonly kind: 'continue';
}
export interface BlockArrayDeclare extends BlockNode {
  readonly kind: 'array_declare';
  readonly name: string;
  readonly length: string;
  readonly values: readonly string[] | null;
}
export interface BlockArrayWrite extends BlockNode {
  readonly kind: 'array_write';
  readonly name: string;
  readonly index: BlockExpression;
  readonly value: BlockExpression;
}
export interface BlockPrint extends BlockNode {
  readonly kind: 'print';
  /** Semantic text: newlines/backslashes/quotes are escaped by the generator. */
  readonly format: string;
  readonly args: readonly BlockExpression[];
}
export interface BlockReturn extends BlockNode {
  readonly kind: 'return';
  readonly value: BlockExpression;
}
export interface BlockScope extends BlockNode {
  readonly kind: 'scope';
  readonly body: readonly BlockStatement[];
}
export type BlockStatement =
  | BlockInput
  | BlockDeclare
  | BlockAssign
  | BlockIf
  | BlockWhile
  | BlockFor
  | BlockBreak
  | BlockContinue
  | BlockArrayDeclare
  | BlockArrayWrite
  | BlockPrint
  | BlockReturn
  | BlockScope;
export interface BlockProgram extends BlockNode {
  readonly kind: 'main';
  readonly body: readonly BlockStatement[];
}

// These guards follow the frozen source/depth budgets. They do not turn the
// course's 30 input elements into a limit on ordinary C array declarations.
export const BLOCK_LIMITS = Object.freeze({ nodes: 32768, depth: 64, sourceBytes: 32768 });
