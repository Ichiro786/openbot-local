import { Alert as NativeAlert } from "react-native";
import { appDialogs } from "./app-dialog-state";
import { isAndroid } from "./platform";
import { currentText } from "./text";

/** Application alerts use themed Android dialogs. System prompts and the iOS alert API stay native. */
export const Alert: Pick<typeof NativeAlert, "alert" | "prompt"> = {
  alert(title, message, buttons, options) {
    if (
      isAndroid &&
      appDialogs.show({
        title,
        message,
        buttons: buttons?.length ? buttons : [{ text: currentText().t("common.close") }],
        options,
      })
    ) {
      return;
    }
    // Before the root mounts, and in a crash screen, there is no portal host.
    NativeAlert.alert(title, message, buttons, options);
  },
  prompt: NativeAlert.prompt,
};
