import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const COPIED_MS = 1_400;

export async function copyToClipboard(text: string, failedTitle: MobileTextKey, t: MobileTranslate): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    void haptics.notification("success");
    return true;
  } catch (error) {
    void haptics.notification("error");
    showFailureAlert(error, "turn", t(failedTitle), t("mobile.chat.copyFailedMessage"));
    return false;
  }
}

export function useCopyMessage(text: string) {
  const { t } = useText();
  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);
  async function copy() {
    const done = await copyToClipboard(text, "mobile.chat.message.copyFailed", t);
    if (!done) return false;
    setCopied(true);
    clearTimeout(reset.current);
    reset.current = setTimeout(() => setCopied(false), COPIED_MS);
    return true;
  }
  return { copy, copied };
}
