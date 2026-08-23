import type {
  ImageToolOperation,
  ImageToolResult,
} from "../../../types/imageTools";

export interface ImageToolUseCase<Input = unknown> {
  execute(input: Input): Promise<ImageToolResult> | ImageToolResult;
  operation: ImageToolOperation;
}

export class ImageToolDispatcher {
  readonly #useCases = new Map<
    ImageToolOperation,
    ImageToolUseCase<unknown>
  >();

  constructor(useCases: readonly ImageToolUseCase<never>[] = []) {
    for (const useCase of useCases) this.register(useCase);
  }

  register<Input>(useCase: ImageToolUseCase<Input>) {
    if (this.#useCases.has(useCase.operation)) {
      throw new Error(`Duplicate image tool use case: ${useCase.operation}`);
    }
    this.#useCases.set(
      useCase.operation,
      useCase as ImageToolUseCase<unknown>,
    );
    return this;
  }

  async execute<Input>(operation: ImageToolOperation, input: Input) {
    const useCase = this.#useCases.get(operation);
    if (!useCase) throw new Error(`Image tool is not registered: ${operation}`);
    return useCase.execute(input);
  }
}

export function createImageToolDispatcher(
  useCases: readonly ImageToolUseCase<never>[] = [],
) {
  return new ImageToolDispatcher(useCases);
}
