export function createComposerSendGate() {
  let submitted = false;
  let closing = false;
  let resetting = false;
  return {
    focus() {
      submitted = false;
      closing = false;
      resetting = false;
    },
    edit() {
      submitted = false;
    },
    allowRetry() {
      submitted = false;
    },
    submit(fieldFocused: boolean): boolean {
      if (submitted) return false;
      submitted = true;
      closing = fieldFocused;
      return true;
    },
    holdFieldText() {
      resetting = true;
    },
    releaseFieldText() {
      resetting = false;
    },
    ignoresFieldText(): boolean {
      return closing || resetting;
    },
    endEditing(): boolean {
      const sentDraft = closing;
      closing = false;
      return sentDraft;
    },
  };
}
