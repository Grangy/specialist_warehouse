type ChatEvent =
  | { type: 'message.created'; roomKey: string; messageId: string }
  | { type: 'avatar.updated'; userId: string };

type Subscriber = {
  id: string;
  send: (evt: ChatEvent) => void;
  close: () => void;
};

declare global {
  var __chatPubSub__: {
    subs: Map<string, Subscriber>;
    subscribe: (sub: Subscriber) => () => void;
    publish: (evt: ChatEvent) => void;
  } | undefined;
}

function getSingleton() {
  if (globalThis.__chatPubSub__) return globalThis.__chatPubSub__;

  const subs = new Map<string, Subscriber>();

  const subscribe = (sub: Subscriber) => {
    subs.set(sub.id, sub);
    return () => {
      subs.delete(sub.id);
      try {
        sub.close();
      } catch {
        // ignore
      }
    };
  };

  const publish = (evt: ChatEvent) => {
    for (const sub of subs.values()) {
      try {
        sub.send(evt);
      } catch {
        // ignore broken client
      }
    }
  };

  globalThis.__chatPubSub__ = { subs, subscribe, publish };
  return globalThis.__chatPubSub__;
}

export const chatPubSub = getSingleton();
export type { ChatEvent };
