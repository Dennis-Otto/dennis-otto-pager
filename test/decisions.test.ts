// The questions and reports of the maintainer's own agents, which the control
// repository forwards, signed: a question becomes a thing in a topic of its own with
// its options as buttons, and a press saves the answer on the branch of the answers
// of the control repository, where the agent reads it; a report is a message in a
// topic of its own, which keeps nothing.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  handleControl,
  MAX_OPTIONS,
  MAX_REASON,
  MAX_TITLE,
} from "../src/control.ts";
import { hmacHex } from "../src/crypto.ts";
import {
  type Decision,
  itemId,
  keys,
  MAX_ANSWER,
  MAX_OPTION,
  MAX_QUESTION,
} from "../src/store.ts";
import { TOPIC_COLORS } from "../src/telegram.ts";
import { handleUpdate } from "../src/updates.ts";
import {
  CHAT,
  json,
  type Net,
  START,
  type World,
  withControl,
  withTopics,
  world,
} from "./helpers.ts";

const CONTROL = "/repos/Dennis-Otto/control";
const FILE = `${CONTROL}/contents/answers/n15-merge-order.json`;

const QUESTION = {
  type: "ask",
  id: "n15-merge-order",
  question: "Which release goes first tonight?",
  options: ["The blueprint", "The pager"],
};

async function send(w: World, value: unknown) {
  const body = JSON.stringify(value);
  const stamp = String(START / 1000);
  const response = await handleControl(
    w.context,
    new Request("https://pager.example/control", {
      method: "POST",
      headers: {
        "x-pager-timestamp": stamp,
        "x-pager-signature": `sha256=${await hmacHex("control-secret", `${stamp}.${body}`)}`,
      },
      body,
    }),
  );
  return { status: response.status, text: await response.text() };
}

async function idOf(ask = QUESTION.id): Promise<string> {
  return itemId(keys.decision(ask));
}

async function stored(w: World): Promise<Decision> {
  return (await w.context.store.get(await idOf())) as Decision;
}

/** Press a button of the message of the question, as the maintainer. */
function press(w: World, data: string) {
  return handleUpdate(w.context, {
    callback_query: {
      id: "q1",
      from: { id: CHAT },
      data,
      message: { message_id: 100 },
    },
  });
}

function answered(w: World) {
  return w.net.telegram("answerCallbackQuery").map((call) => ({
    text: call.body.text,
    alert: call.body.show_alert,
  }));
}

/** A control repository whose branch of the answers isn't there yet. */
function withoutBranch(net: Net): Net {
  return net
    .on("POST", `${CONTROL}/git/trees`, () => json({ sha: "tree1" }, 201))
    .on("POST", `${CONTROL}/git/commits`, () => json({ sha: "commit1" }, 201))
    .on("POST", `${CONTROL}/git/refs`, () => json({}, 201))
    .on("PUT", FILE, () => json({ content: {} }, 201));
}

/** The answer as the file on the branch holds it. */
function saved(content: string): unknown {
  const bytes = Uint8Array.from(atob(content), (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

describe("a question of an agent", () => {
  it("comes in a topic of its own, with one button per option", async () => {
    const w = await world();
    withTopics(withControl(w.net));
    expect(await send(w, QUESTION)).toEqual({ status: 200, text: "asked" });
    const id = await idOf();
    expect(w.net.telegram("createForumTopic").map((call) => call.body)).toEqual(
      [
        {
          chat_id: CHAT,
          name: "🤔 Decision: Which release goes first tonight?",
          icon_color: TOPIC_COLORS.violet,
        },
      ],
    );
    const [message] = w.net.telegram("sendMessage").map((call) => call.body);
    expect(message.text).toBe(
      "🤔 <b>A decision for you</b>\nWhich release goes first tonight?",
    );
    expect(message.message_thread_id).toBe(900);
    expect(message.reply_markup.inline_keyboard).toEqual([
      [{ text: "The blueprint", callback_data: `choose:${id}:0` }],
      [{ text: "The pager", callback_data: `choose:${id}:1` }],
    ]);
    expect(await stored(w)).toMatchObject({
      kind: "decision",
      state: "open",
      repo: "Dennis-Otto/control",
      installation: 77,
      ask: "n15-merge-order",
      choice: null,
      topic: { thread: 900 },
    });
  });

  it("is asked once for the same id, and an answer stays as it was given", async () => {
    const w = await world();
    withoutBranch(withControl(w.net));
    expect((await send(w, QUESTION)).text).toBe("asked");
    expect((await send(w, { ...QUESTION, question: "Again?" })).text).toBe(
      "asked",
    );
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
    await press(w, `choose:${await idOf()}:0`);
    expect(await send(w, QUESTION)).toEqual({
      status: 409,
      text: "Conflict",
    });
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
  });

  it("takes an id, a question and two to four different options, and nothing else", async () => {
    const w = await world();
    withControl(w.net);
    const options = ["A", "B", "C", "D", "E"];
    const wrong = [
      { ...QUESTION, id: undefined },
      { ...QUESTION, id: 7 },
      { ...QUESTION, id: "../answers" },
      { ...QUESTION, id: "a".repeat(65) },
      { ...QUESTION, question: undefined },
      { ...QUESTION, question: "  " },
      { ...QUESTION, question: "?".repeat(MAX_QUESTION + 1) },
      { ...QUESTION, options: "A or B" },
      { ...QUESTION, options: ["A"] },
      { ...QUESTION, options: options.slice(0, MAX_OPTIONS + 1) },
      { ...QUESTION, options: ["A", " "] },
      { ...QUESTION, options: ["A", 2] },
      { ...QUESTION, options: ["A", "B".repeat(MAX_OPTION + 1)] },
      { ...QUESTION, options: ["A", " A "] },
    ];
    for (const body of wrong) {
      expect(await send(w, body), JSON.stringify(body)).toEqual({
        status: 400,
        text: "Bad Request",
      });
    }
    expect(w.net.telegram("sendMessage")).toHaveLength(0);
    const widest = {
      ...QUESTION,
      id: `A${"b".repeat(63)}`,
      question: "?".repeat(MAX_QUESTION),
      options: [" A ", "B".repeat(MAX_OPTION), "C", "D"],
    };
    expect((await send(w, widest)).text).toBe("asked");
    const [message] = w.net.telegram("sendMessage").map((call) => call.body);
    expect(
      message.reply_markup.inline_keyboard.map(
        (row: { text: string }[]) => row[0]?.text,
      ),
    ).toEqual(["A", "B".repeat(MAX_OPTION), "C", "D"]);
  });

  it("isn't asked while the GitHub App isn't installed on the control repository", async () => {
    const w = await world();
    expect(await send(w, QUESTION)).toEqual({
      status: 503,
      text: "The GitHub App isn't installed on Dennis-Otto/control",
    });
    expect(w.net.telegram("sendMessage")).toHaveLength(0);
  });

  it("saves the answer of a button on a new branch of the answers, and shows it", async () => {
    const w = await world();
    withoutBranch(withTopics(withControl(w.net)));
    await send(w, QUESTION);
    w.clock.now = START + 60000;
    expect(await press(w, `choose:${await idOf()}:1`)).toBe(
      "choose: Saved for your agent: The pager",
    );
    expect(answered(w)).toEqual([
      { text: "Saved for your agent: The pager", alert: false },
    ]);
    expect(
      w.net.github("/access_tokens").map((call) => call.body.permissions),
    ).toEqual([{ contents: "write" }]);
    const [tree] = w.net.github("/git/trees").map((call) => call.body.tree);
    expect(tree).toMatchObject([
      { path: "README.md", mode: "100644", type: "blob" },
    ]);
    expect(w.net.github("/git/commits").map((call) => call.body)).toEqual([
      {
        message: "The branch of the answers of the pager",
        tree: "tree1",
        parents: [],
      },
    ]);
    expect(w.net.github("/git/refs").map((call) => call.body)).toEqual([
      { ref: "refs/heads/pager-answers", sha: "commit1" },
    ]);
    const [put] = w.net.github(FILE).map((call) => call.body);
    expect(put).toEqual({
      message: "The answer to n15-merge-order",
      content: expect.any(String),
      branch: "pager-answers",
    });
    expect(saved(put.content)).toEqual({
      id: "n15-merge-order",
      question: "Which release goes first tonight?",
      options: ["The blueprint", "The pager"],
      choice: 1,
      answer: "The pager",
      answered: "2026-11-04T08:01:00.000Z",
    });
    const [edited] = w.net.telegram("editMessageText").map((call) => call.body);
    expect(edited.text).toBe(
      "🤔 <b>A decision for you</b>\nWhich release goes first tonight?\n\n✅ Your answer: <b>The pager</b>",
    );
    expect(edited.reply_markup.inline_keyboard).toEqual([]);
    expect(
      w.net.telegram("editForumTopic").map((call) => call.body.name),
    ).toEqual(["✅ 🤔 Decision: Which release goes first tonight?"]);
    expect(await stored(w)).toMatchObject({ state: "answered", choice: 1 });
  });

  it("replaces the answer that the branch of the answers has already", async () => {
    const w = await world();
    withControl(w.net)
      .on("GET", `${CONTROL}/git/ref/heads/pager-answers`, () =>
        json({ object: { sha: "head1" } }),
      )
      .on("GET", `${FILE}?ref=pager-answers`, () => json({ sha: "old1" }))
      .on("PUT", FILE, () => json({ content: {} }));
    await send(w, QUESTION);
    await press(w, `choose:${await idOf()}:0`);
    expect(w.net.github("/git/trees")).toHaveLength(0);
    const [put] = w.net.github(FILE).map((call) => call.body);
    expect(put.sha).toBe("old1");
    expect(saved(put.content)).toMatchObject({
      choice: 0,
      answer: "The blueprint",
    });
  });

  it("answers a press that GitHub gives no answer to in time, which may have saved it", async () => {
    const w = await world({}, { api: 20, download: 20 });
    withoutBranch(withControl(w.net)).hang("PUT", FILE);
    await send(w, QUESTION);
    await press(w, `choose:${await idOf()}:0`);
    expect(answered(w)).toEqual([
      {
        text: "⏳ GitHub gave no answer in time, and whether it acted is uncertain: look at the thing on GitHub, then press again.",
        alert: true,
      },
    ]);
    expect(w.net.telegram("editMessageText")).toHaveLength(0);
  });

  it("stays open when GitHub refuses the answer, so that a press saves it again", async () => {
    const w = await world();
    withoutBranch(withControl(w.net)).on("PUT", FILE, () =>
      json({ message: "Conflict" }, 409),
    );
    await send(w, QUESTION);
    const id = await idOf();
    await press(w, `choose:${id}:0`);
    w.net.on("GET", `${CONTROL}/git/ref/heads/pager-answers`, () =>
      json({ message: "Server Error" }, 500),
    );
    await press(w, `choose:${id}:0`);
    expect(answered(w)).toEqual([
      { text: "GitHub refused: Conflict", alert: true },
      { text: "GitHub refused: Server Error", alert: true },
    ]);
    expect(w.net.telegram("editMessageText")).toHaveLength(0);
    expect(await stored(w)).toMatchObject({ state: "open", choice: null });
  });

  it("keeps an answer that GitHub saved, though Telegram refused to show it", async () => {
    const w = await world();
    withoutBranch(withControl(w.net));
    await send(w, QUESTION);
    w.net.on("POST", /\/editMessageText$/, () =>
      json({ ok: false, error_code: 502, description: "Bad Gateway" }, 502),
    );
    const id = await idOf();
    await press(w, `choose:${id}:0`);
    await press(w, `choose:${id}:1`);
    expect(answered(w)).toEqual([
      { text: "Saved for your agent: The blueprint", alert: false },
      { text: "This button is out of date.", alert: true },
    ]);
    expect(
      w.net.github(FILE).filter((call) => call.method === "PUT"),
    ).toHaveLength(1);
    expect(await stored(w)).toMatchObject({ state: "answered", choice: 0 });
  });

  it("refuses a button of no option, and every button once it is answered", async () => {
    const w = await world();
    withoutBranch(withControl(w.net));
    await send(w, QUESTION);
    const id = await idOf();
    await press(w, `choose:${id}:2`);
    await press(w, `choose:${id}`);
    await press(w, `choose:${id}:0`);
    await press(w, `choose:${id}:1`);
    expect(answered(w)).toEqual([
      { text: "This button is unknown.", alert: true },
      { text: "This button is unknown.", alert: true },
      { text: "Saved for your agent: The blueprint", alert: false },
      { text: "This button is out of date.", alert: true },
    ]);
    expect(
      w.net.github(FILE).filter((call) => call.method === "PUT"),
    ).toHaveLength(1);
    expect(await stored(w)).toMatchObject({ state: "answered", choice: 0 });
  });

  it("is asked and answered in German", async () => {
    const w = await world({ language: "de" });
    withoutBranch(withTopics(withControl(w.net)));
    await send(w, QUESTION);
    await press(w, `choose:${await idOf()}:1`);
    expect(
      w.net.telegram("createForumTopic").map((call) => call.body.name),
    ).toEqual(["🤔 Entscheidung: Which release goes first tonight?"]);
    expect(answered(w)).toEqual([
      { text: "Für deinen Agenten gespeichert: The pager", alert: false },
    ]);
    const [edited] = w.net.telegram("editMessageText").map((call) => call.body);
    expect(edited.text).toBe(
      "🤔 <b>Eine Entscheidung für dich</b>\nWhich release goes first tonight?\n\n✅ Deine Antwort: <b>The pager</b>",
    );
  });
});

/** A text of the maintainer in the topic of the question, or in another thread. */
function write(w: World, text: string, thread = 900) {
  return handleUpdate(w.context, {
    message: {
      message_id: 500,
      chat: { id: CHAT },
      from: { id: CHAT },
      text,
      message_thread_id: thread,
      is_topic_message: true,
    },
  });
}

/** A control repository that takes the free texts of the maintainer. */
function withDispatches(net: Net): Net {
  return net.on(
    "POST",
    `${CONTROL}/dispatches`,
    () => new Response(null, { status: 204 }),
  );
}

function reactions(w: World) {
  return w.net
    .telegram("setMessageReaction")
    .map((call) => [call.body.message_id, call.body.reaction[0]?.emoji]);
}

/** What the pager said in a thread, with sendMessage, other than the question itself. */
function said(w: World) {
  return w.net
    .telegram("sendMessage")
    .slice(1)
    .map((call) => [call.body.message_thread_id, call.body.text]);
}

describe("an answer in the maintainer's own words", () => {
  it("is a text in the topic of the question, saved where a button saves its option, without a choice", async () => {
    const w = await world();
    withoutBranch(withTopics(withControl(w.net)));
    await send(w, QUESTION);
    w.clock.now = START + 120000;
    expect(
      await write(w, "  Neither: wait for <the release> of Paperless.  "),
    ).toBe("an answer in words");
    const [put] = w.net.github(FILE).map((call) => call.body);
    expect(put.message).toBe("The answer to n15-merge-order");
    expect(saved(put.content)).toEqual({
      id: "n15-merge-order",
      question: "Which release goes first tonight?",
      options: ["The blueprint", "The pager"],
      choice: null,
      answer: "Neither: wait for <the release> of Paperless.",
      answered: "2026-11-04T08:02:00.000Z",
    });
    const [edited] = w.net.telegram("editMessageText").map((call) => call.body);
    expect(edited.text).toBe(
      "🤔 <b>A decision for you</b>\nWhich release goes first tonight?\n\n✅ Your answer, in your own words:\nNeither: wait for &lt;the release&gt; of Paperless.",
    );
    expect(edited.reply_markup.inline_keyboard).toEqual([]);
    expect(
      w.net.telegram("editForumTopic").map((call) => call.body.name),
    ).toEqual(["✅ 🤔 Decision: Which release goes first tonight?"]);
    expect(reactions(w)).toEqual([[500, "👍"]]);
    // It is the agent's answer, not a question for Claude.
    expect(w.net.github("/dispatches")).toHaveLength(0);
    expect(said(w)).toEqual([]);
    expect(await stored(w)).toMatchObject({
      state: "answered",
      choice: null,
      ownAnswer: "Neither: wait for <the release> of Paperless.",
    });
    expect(await press(w, `choose:${await idOf()}:0`)).toBe(
      "choose: This button is out of date.",
    );
  });

  it("takes as many characters as the agent reads, and says so for a longer one, which leaves the question open", async () => {
    const w = await world();
    withoutBranch(withTopics(withControl(w.net)));
    await send(w, QUESTION);
    expect(await write(w, "x".repeat(MAX_ANSWER + 1))).toBe(
      "an answer that is too long",
    );
    expect(said(w)).toEqual([
      [
        900,
        `That answer has ${MAX_ANSWER + 1} characters; your agent takes ${MAX_ANSWER} at most. Write a shorter one, or press an option.`,
      ],
    ]);
    expect(w.net.github(FILE)).toHaveLength(0);
    expect(await stored(w)).toMatchObject({ state: "open" });
    expect(await write(w, "x".repeat(MAX_ANSWER))).toBe("an answer in words");
    expect(await stored(w)).toMatchObject({
      state: "answered",
      ownAnswer: "x".repeat(MAX_ANSWER),
    });
  });

  it("stays open when GitHub refuses it, and the topic says why", async () => {
    const w = await world();
    withoutBranch(withTopics(withControl(w.net))).on("PUT", FILE, () =>
      json({ message: "Conflict <sha>" }, 409),
    );
    await send(w, QUESTION);
    expect(await write(w, "Neither.")).toBe("an answer that GitHub refused");
    expect(said(w)).toEqual([
      [
        900,
        "😢 Not saved for your agent: GitHub refused: Conflict &lt;sha&gt;. The question stays open: write your answer again, or press an option.",
      ],
    ]);
    expect(reactions(w)).toEqual([[500, "😢"]]);
    expect(w.net.telegram("editMessageText")).toHaveLength(0);
    expect(await stored(w)).toMatchObject({ state: "open", choice: null });
    expect(await stored(w)).not.toHaveProperty("ownAnswer");
  });

  it("fails the update on a failure of the network, which the log keeps", async () => {
    const w = await world();
    withoutBranch(withTopics(withControl(w.net))).on("PUT", FILE, () => {
      throw new TypeError("Network connection lost.");
    });
    await send(w, QUESTION);
    await expect(write(w, "Neither.")).rejects.toThrow(
      "Network connection lost.",
    );
    expect(await stored(w)).toMatchObject({ state: "open" });
  });

  it("is a text in the topic of an open question only: one that ended, and another thread, go to the control repository", async () => {
    const w = await world();
    withDispatches(withoutBranch(withTopics(withControl(w.net))));
    await send(w, QUESTION);
    expect(await write(w, "And the pager?", 950)).toBe("free text sent");
    await press(w, `choose:${await idOf()}:1`);
    expect(await write(w, "Why did I choose that?")).toBe("free text sent");
    expect(
      w.net
        .github("/dispatches")
        .map((call) => [
          call.body.event_type,
          call.body.client_payload.text,
          call.body.client_payload.thing?.kind,
          call.body.client_payload.thing?.state,
        ]),
    ).toEqual([
      ["pager-text", "And the pager?", undefined, undefined],
      ["pager-text", "Why did I choose that?", "decision", "answered"],
    ]);
    expect(
      w.net.github(FILE).filter((call) => call.method === "PUT"),
    ).toHaveLength(1);
  });

  it("is saved and shown in German", async () => {
    const w = await world({ language: "de" });
    withoutBranch(withTopics(withControl(w.net)));
    await send(w, QUESTION);
    await write(w, "Keins von beiden.");
    const [edited] = w.net.telegram("editMessageText").map((call) => call.body);
    expect(edited.text).toBe(
      "🤔 <b>Eine Entscheidung für dich</b>\nWhich release goes first tonight?\n\n✅ Deine Antwort, in deinen eigenen Worten:\nKeins von beiden.",
    );
  });
});

describe("a question that its agent takes back", () => {
  const WITHDRAW = { type: "withdraw", id: QUESTION.id };

  it("loses its buttons, and its message and its topic say so, with the reason", async () => {
    const w = await world();
    withTopics(withControl(w.net));
    await send(w, QUESTION);
    expect(
      await send(w, {
        ...WITHDRAW,
        reason: "  No answer within the hour: the <blueprint> went first.  ",
      }),
    ).toEqual({ status: 200, text: "withdrawn" });
    const [edited] = w.net.telegram("editMessageText").map((call) => call.body);
    expect(edited.text).toBe(
      "🤔 <b>A decision for you</b>\nWhich release goes first tonight?\n\n↩️ Your agent took this question back: it no longer waits for an answer.\n<i>No answer within the hour: the &lt;blueprint&gt; went first.</i>",
    );
    expect(edited.reply_markup.inline_keyboard).toEqual([]);
    expect(
      w.net.telegram("editForumTopic").map((call) => call.body.name),
    ).toEqual(["✅ 🤔 Decision: Which release goes first tonight?"]);
    expect(await stored(w)).toMatchObject({
      state: "withdrawn",
      choice: null,
      note: "No answer within the hour: the <blueprint> went first.",
    });
    // Nothing is saved for the agent: it no longer reads an answer.
    expect(w.net.github(FILE)).toHaveLength(0);
    expect(await press(w, `choose:${await idOf()}:0`)).toBe(
      "choose: This button is out of date.",
    );
  });

  it("is taken back once, keeps its id used, and leaves a text in its topic to the control repository", async () => {
    const w = await world();
    withDispatches(withTopics(withControl(w.net)));
    await send(w, QUESTION);
    await send(w, WITHDRAW);
    expect(await send(w, WITHDRAW)).toEqual({
      status: 200,
      text: "withdrawn",
    });
    expect(w.net.telegram("editMessageText")).toHaveLength(1);
    const [edited] = w.net.telegram("editMessageText").map((call) => call.body);
    expect(edited.text).toBe(
      "🤔 <b>A decision for you</b>\nWhich release goes first tonight?\n\n↩️ Your agent took this question back: it no longer waits for an answer.",
    );
    expect(await send(w, QUESTION)).toEqual({
      status: 409,
      text: "Conflict",
    });
    expect(await write(w, "Why?")).toBe("free text sent");
    expect(await stored(w)).toMatchObject({ state: "withdrawn", note: null });
  });

  it("keeps an answer that came first, and finds no question that the pager doesn't know", async () => {
    const w = await world();
    withoutBranch(withTopics(withControl(w.net)));
    expect(await send(w, WITHDRAW)).toEqual({
      status: 404,
      text: "Not Found",
    });
    await send(w, QUESTION);
    await press(w, `choose:${await idOf()}:0`);
    expect(await send(w, WITHDRAW)).toEqual({
      status: 409,
      text: "Conflict",
    });
    expect(await stored(w)).toMatchObject({ state: "answered", choice: 0 });
    expect(w.net.telegram("editMessageText")).toHaveLength(1);
  });

  it("takes an id and a short reason, and nothing else", async () => {
    const w = await world();
    const wrong = [
      { type: "withdraw" },
      { ...WITHDRAW, id: 7 },
      { ...WITHDRAW, id: "../answers" },
      { ...WITHDRAW, reason: 7 },
      { ...WITHDRAW, reason: "  " },
      { ...WITHDRAW, reason: "r".repeat(MAX_REASON + 1) },
    ];
    for (const body of wrong) {
      expect(await send(w, body), JSON.stringify(body)).toEqual({
        status: 400,
        text: "Bad Request",
      });
    }
    // A body that the pager takes, for a question that it doesn't know.
    expect(
      (await send(w, { ...WITHDRAW, reason: ` ${"r".repeat(MAX_REASON)} ` }))
        .status,
    ).toBe(404);
  });

  it("is taken back in German", async () => {
    const w = await world({ language: "de" });
    withControl(w.net);
    await send(w, QUESTION);
    await send(w, WITHDRAW);
    const [edited] = w.net.telegram("editMessageText").map((call) => call.body);
    expect(edited.text).toBe(
      "🤔 <b>Eine Entscheidung für dich</b>\nWhich release goes first tonight?\n\n↩️ Dein Agent hat die Frage zurückgenommen: Er wartet nicht mehr auf eine Antwort.",
    );
  });
});

describe("the report of a run", () => {
  it("opens a topic of its own, named after its title, without buttons", async () => {
    const w = await world();
    withTopics(w.net);
    const report = {
      type: "report",
      title: "  Night   run\n2026-11-08 ",
      text: "Merged: 3 <pull requests>",
    };
    expect(await send(w, report)).toEqual({ status: 200, text: "reported" });
    expect(w.net.telegram("createForumTopic").map((call) => call.body)).toEqual(
      [
        {
          chat_id: CHAT,
          name: "🧾 Run: Night run 2026-11-08",
          icon_color: TOPIC_COLORS.green,
        },
      ],
    );
    const [message] = w.net.telegram("sendMessage").map((call) => call.body);
    expect(message).toMatchObject({
      text: "🧾 <b>The report of a run</b>\nMerged: 3 &lt;pull requests&gt;",
      message_thread_id: 900,
      reply_markup: { inline_keyboard: [] },
    });
    expect((await env.PAGER.list()).keys).toEqual([]);
  });

  it("is named for a run without a title, and goes into the main view of a chat without topics", async () => {
    const w = await world({ language: "de" });
    expect(await send(w, { type: "report", text: "Fertig." })).toEqual({
      status: 200,
      text: "reported",
    });
    const [message] = w.net.telegram("sendMessage").map((call) => call.body);
    expect(message.text).toBe("🧾 <b>Der Bericht eines Laufs</b>\nFertig.");
    expect(message.message_thread_id).toBeUndefined();
    const named = await world();
    withTopics(named.net);
    await send(named, { type: "report", text: "Done." });
    expect(
      named.net.telegram("createForumTopic").map((call) => call.body.name),
    ).toEqual(["🧾 Run"]);
  });

  it("takes a text and a short title, and nothing else", async () => {
    const w = await world();
    const wrong = [
      { type: "report" },
      { type: "report", text: " " },
      { type: "report", text: "Done.", title: 7 },
      { type: "report", text: "Done.", title: " " },
      { type: "report", text: "Done.", title: "t".repeat(MAX_TITLE + 1) },
    ];
    for (const body of wrong) {
      expect((await send(w, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(
      (
        await send(w, {
          type: "report",
          text: "Done.",
          title: "t".repeat(MAX_TITLE),
        })
      ).text,
    ).toBe("reported");
  });
});
