/**
 * Base for errors this server raises deliberately.
 *
 * Tool handlers turn any thrown error into a tool result, so the distinction
 * that matters is not the class but the message: it is read by a person or a
 * model deciding what to do next. Every subclass therefore writes a message
 * that names the fix, not just the fault.
 */
export abstract class ApplicationError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}
