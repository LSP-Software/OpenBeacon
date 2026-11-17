export class GroupKeyUnavailableError extends Error {
  constructor() {
    super("This phone can’t use this group’s current key yet.");
  }
}

export class ImageStorageError extends Error {
  constructor(status: number | null) {
    super(
      status === null
        ? "Image storage didn’t answer."
        : `Image storage refused: ${status.toString()}`,
    );
  }
}
