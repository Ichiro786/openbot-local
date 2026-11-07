import type { NotificationTarget } from "./push-notifications-native.types";

export function isCurrentNotificationChat(
  target: NotificationTarget | null,
  current: NotificationTarget | null,
): boolean {
  return Boolean(
    target?.threadId &&
      current?.threadId &&
      target.serverId &&
      current.serverId &&
      target.agentId === current.agentId &&
      target.serverId === current.serverId &&
      target.threadId === current.threadId,
  );
}
