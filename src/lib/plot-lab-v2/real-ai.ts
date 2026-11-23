import { generateText, jsonSchema, Output } from "ai";
import { getAIModel, getConfiguredProviders } from "@/lib/ai/providers";
import type {
  PlotLabConnectedBatch,
  PlotLabMessage,
  PlotLabSessionState,
  PlotLabStoryBrief,
  PlotLabStorySoul,
} from "@/lib/plot-lab-v2/contracts";
import {
  countSentences,
  findMissingSkeletonElement,
  normalizeSkeletonElement,
} from "@/lib/plot-lab-v2/output-validation";
import {
  PLOT_LAB_CONNECTOR_PROMPT_VERSION,
  PLOT_LAB_CONNECTOR_SYSTEM_PROMPT,
  PLOT_LAB_CONVERSATION_PROMPT_VERSION,
  PLOT_LAB_CONVERSATION_SYSTEM_PROMPT,
  PLOT_LAB_CREATIVE_PROMPT_VERSION,
  PLOT_LAB_CREATIVE_SYSTEM_PROMPT,
  PLOT_LAB_INTERVIEWER_PROMPT_VERSION,
  PLOT_LAB_INTERVIEWER_SYSTEM_PROMPT,
} from "@/lib/plot-lab-v2/prompts";

export function isPlotLabRealAIEnabled(): boolean {
  return process.env.PLOT_LAB_REAL_AI_ENABLED === "true";
}

export interface PlotLabModelChoice {
  modelId: string;
  thinking: boolean;
}

interface InterviewOutput {
  ready: boolean;
  message: string;
  questionKind: "story" | "monetization" | "major_reveal" | "none";
  question: string;
  starters: string[];
  storyBrief: PlotLabStoryBrief;
}

export interface CreativeRoute {
  storySoul: PlotLabStorySoul;
  monetizationPoint: string;
  requiredSkeletonElements: string[];
  units: CreativeUnit[];
}

interface ConnectedOutput {
  units: PlotLabConnectedBatch["units"];
  seedCoverage: PlotLabConnectedBatch["seedCoverage"];
  warnings: string[];
}

export interface PlotLabConversationTurn {
  kind: "discussion" | "mutation_proposal";
  message: string;
  instruction: string;
  targetUnitNumbers: number[];
  downstreamUnitNumbers: number[];
  explanation: string;
}

const interviewOutput = Output.object({
  name: "plot_lab_interview_turn",
  description: "One Levi interview turn or a ready signal.",
  schema: jsonSchema<InterviewOutput>({
    type: "object",
    additionalProperties: false,
    required: ["ready", "message", "questionKind", "question", "starters", "storyBrief"],
    properties: {
      ready: { type: "boolean" },
      message: { type: "string" },
      questionKind: {
        type: "string",
        enum: ["story", "monetization", "major_reveal", "none"],
      },
      question: { type: "string" },
      starters: { type: "array", items: { type: "string" }, maxItems: 2 },
      storyBrief: {
        type: "object",
        additionalProperties: false,
        required: ["storySoul", "monetizationPoint", "requiredSkeletonElements"],
        properties: {
          storySoul: {
            type: "object",
            additionalProperties: false,
            required: [
              "premise",
              "characterEngine",
              "centralRelationship",
              "emotionalPromise",
              "tone",
              "unresolvedPressure",
            ],
            properties: {
              premise: { type: "string" },
              characterEngine: { type: "string" },
              centralRelationship: { type: "string" },
              emotionalPromise: { type: "string" },
              tone: { type: "string" },
              unresolvedPressure: { type: "string" },
            },
          },
          monetizationPoint: { type: "string" },
          requiredSkeletonElements: { type: "array", items: { type: "string" } },
        },
      },
    },
  }),
});

const creativeOutput = Output.object({
  name: "plot_lab_creative_route",
  description: "The complete first creative route.",
  schema: jsonSchema<CreativeRoute>({
    type: "object",
    additionalProperties: false,
    required: ["storySoul", "monetizationPoint", "requiredSkeletonElements", "units"],
    properties: {
      storySoul: {
        type: "object",
        additionalProperties: false,
        required: [
          "premise",
          "characterEngine",
          "centralRelationship",
          "emotionalPromise",
          "tone",
          "unresolvedPressure",
        ],
        properties: {
          premise: { type: "string" },
          characterEngine: { type: "string" },
          centralRelationship: { type: "string" },
          emotionalPromise: { type: "string" },
          tone: { type: "string" },
          unresolvedPressure: { type: "string" },
        },
      },
      monetizationPoint: { type: "string" },
      requiredSkeletonElements: {
        type: "array",
        minItems: 1,
        items: { type: "string" },
      },
      units: {
        type: "array",
        minItems: 4,
        maxItems: 7,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "number",
            "title",
            "cause",
            "soulConnection",
            "dramaticMove",
            "characterChoice",
            "consequence",
            "endingPressure",
            "skeletonElementsUsed",
            "revelationPurpose",
          ],
          properties: {
            number: { type: "integer" },
            title: { type: "string" },
            cause: { type: "string" },
            soulConnection: { type: "string" },
            dramaticMove: { type: "string" },
            characterChoice: { type: "string" },
            consequence: { type: "string" },
            endingPressure: { type: "string" },
            skeletonElementsUsed: { type: "array", items: { type: "string" } },
            revelationPurpose: { type: "string" },
          },
        },
      },
    },
  }),
});

const connectedOutput = Output.object({
  name: "plot_lab_connected_batch",
  description: "The final connected story batch shown to the writer.",
  schema: jsonSchema<ConnectedOutput>({
    type: "object",
    additionalProperties: false,
    required: ["units", "seedCoverage", "warnings"],
    properties: {
      units: {
        type: "array",
        minItems: 4,
        maxItems: 7,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "number",
            "title",
            "cause",
            "soulConnection",
            "characterChoice",
            "consequence",
            "nextPressure",
            "emotionalChange",
            "endingTurn",
            "skeletonElementsUsed",
            "revelationPurpose",
            "visiblePlot",
          ],
          properties: {
            number: { type: "integer" },
            title: { type: "string" },
            cause: { type: "string" },
            soulConnection: { type: "string" },
            characterChoice: { type: "string" },
            consequence: { type: "string" },
            nextPressure: { type: "string" },
            emotionalChange: { type: "string" },
            endingTurn: { type: "string" },
            skeletonElementsUsed: { type: "array", items: { type: "string" } },
            revelationPurpose: { type: "string" },
            visiblePlot: { type: "string" },
          },
        },
      },
      seedCoverage: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["element", "unitNumbers"],
          properties: {
            element: { type: "string" },
            unitNumbers: { type: "array", items: { type: "integer" } },
          },
        },
      },
      warnings: { type: "array", items: { type: "string" } },
    },
  }),
});

const conversationOutput = Output.object({
  name: "plot_lab_follow_up_turn",
  description: "A post-batch discussion response or a non-applying change proposal.",
  schema: jsonSchema<PlotLabConversationTurn>({
    type: "object",
    additionalProperties: false,
    required: [
      "kind",
      "message",
      "instruction",
      "targetUnitNumbers",
      "downstreamUnitNumbers",
      "explanation",
    ],
    properties: {
      kind: { type: "string", enum: ["discussion", "mutation_proposal"] },
      message: { type: "string" },
      instruction: { type: "string" },
      targetUnitNumbers: { type: "array", items: { type: "integer" } },
      downstreamUnitNumbers: { type: "array", items: { type: "integer" } },
      explanation: { type: "string" },
    },
  }),
});

export async function resolvePlotLabModel(): Promise<PlotLabModelChoice> {
  const providers = await getConfiguredProviders();
  if (providers.includes("openai")) return { modelId: "gpt-5.2", thinking: false };
  if (providers.includes("anthropic")) return { modelId: "claude-sonnet-4-20250514", thinking: false };
  if (providers.includes("google")) return { modelId: "gemini-3.1-pro-preview", thinking: false };
  throw new Error("Configure one AI provider in Admin → AI Settings before starting Plot Lab.");
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Levi returned an unreadable response.");
  return JSON.parse(trimmed.slice(first, last + 1));
}

function stringValue(value: unknown, max = 4_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function contextPacket(session: PlotLabSessionState, messages: PlotLabMessage[]): string {
  const references = session.referenceSnapshots.map((reference) => reference.capturedText).filter(Boolean);
  const transcript = messages
    .filter((message) => !message.supersededAt)
    .map((message) => (message.role === "writer" ? "Writer: " : "Levi: ") + message.content)
    .join("\n");
  return JSON.stringify({
    orientation: session.orientation,
    source: session.sourceSnapshot ?? {},
    seed: session.seed ?? "",
    references,
    storyBrief: session.interviewCheckpoint.characterBrief ?? null,
    transcript,
  });
}

export interface RealInterviewTurn {
  ready: boolean;
  message: string;
  questionKind: "story" | "monetization" | "major_reveal" | "none";
  question: string;
  starters: [string, string] | [];
  storyBrief: PlotLabStoryBrief;
}

function parseStoryBrief(value: unknown): PlotLabStoryBrief {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawSoul = raw.storySoul && typeof raw.storySoul === "object"
    ? raw.storySoul as Record<string, unknown>
    : {};
  const storyBrief: PlotLabStoryBrief = {
    storySoul: {
      premise: stringValue(rawSoul.premise),
      characterEngine: stringValue(rawSoul.characterEngine),
      centralRelationship: stringValue(rawSoul.centralRelationship),
      emotionalPromise: stringValue(rawSoul.emotionalPromise),
      tone: stringValue(rawSoul.tone),
      unresolvedPressure: stringValue(rawSoul.unresolvedPressure),
    },
    monetizationPoint: stringValue(raw.monetizationPoint),
    requiredSkeletonElements: stringArray(raw.requiredSkeletonElements),
  };
  if (
    Object.values(storyBrief.storySoul).some((part) => !part) ||
    !storyBrief.monetizationPoint ||
    storyBrief.requiredSkeletonElements.length === 0
  ) {
    throw new Error("Levi's hidden story brief was incomplete. Please try again.");
  }
  return storyBrief;
}

export async function generateRealInterviewTurn(input: {
  session: PlotLabSessionState;
  messages: PlotLabMessage[];
  model: PlotLabModelChoice;
  forceQuestion?: boolean;
}): Promise<RealInterviewTurn> {
  const model = await getAIModel(input.model.modelId, input.model.thinking);
  const instruction = input.forceQuestion
    ? "The writer requested generation, but one blocking decision is still required. Ask exactly that one question."
    : "Decide whether another creative question is genuinely necessary.";
  const result = await generateText({
    model,
    system: PLOT_LAB_INTERVIEWER_SYSTEM_PROMPT,
    prompt: contextPacket(input.session, input.messages) + "\n\n" + instruction,
    output: interviewOutput,
  });
  const parsed = result.output as unknown as Record<string, unknown>;
  const ready = parsed.ready === true && !input.forceQuestion;
  const rawQuestionKind = stringValue(parsed.questionKind, 40);
  const questionKind = ready
    ? "none"
    : rawQuestionKind === "monetization" || rawQuestionKind === "major_reveal"
      ? rawQuestionKind
      : "story";
  const question = ready ? "" : stringValue(parsed.question, 600);
  const rawStarters = Array.isArray(parsed.starters)
    ? parsed.starters.map((value) => stringValue(value, 300)).filter(Boolean)
    : [];
  if (!ready && (!question || rawStarters.length !== 2)) {
    throw new Error("Levi's interview response was incomplete. Please try again.");
  }
  const storyBrief = parseStoryBrief(parsed.storyBrief);
  return {
    ready,
    message: stringValue(parsed.message, 800) || (ready ? "I have enough to build the first route." : question),
    questionKind,
    question,
    starters: ready ? [] : [rawStarters[0], rawStarters[1]],
    storyBrief,
  };
}

export interface CreativeUnit {
  number: number;
  title?: string;
  cause: string;
  soulConnection: string;
  dramaticMove: string;
  characterChoice: string;
  consequence: string;
  endingPressure: string;
  skeletonElementsUsed: string[];
  revelationPurpose: string;
}

function stringArray(value: unknown, maxItems = 50): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => stringValue(item, 500))
    .filter(Boolean);
}

function expectedNumbers(orientation: PlotLabSessionState["orientation"], length: number): number[] {
  return orientation === "portrait" ? [2, 3, 4, 5, 6, 7, 8] : Array.from({ length }, (_, index) => index + 1);
}

function validLength(orientation: PlotLabSessionState["orientation"], length: number): boolean {
  return orientation === "portrait" ? length === 7 : length === 4 || length === 5;
}

export function parsePlotLabCreativeResponse(
  text: string,
  orientation: PlotLabSessionState["orientation"]
): CreativeRoute {
  const parsed = extractJson(text) as Record<string, unknown>;
  if (!Array.isArray(parsed.units)) throw new Error("Creative route did not contain units.");
  const rawSoul = parsed.storySoul && typeof parsed.storySoul === "object"
    ? parsed.storySoul as Record<string, unknown>
    : {};
  const storySoul: PlotLabStorySoul = {
    premise: stringValue(rawSoul.premise),
    characterEngine: stringValue(rawSoul.characterEngine),
    centralRelationship: stringValue(rawSoul.centralRelationship),
    emotionalPromise: stringValue(rawSoul.emotionalPromise),
    tone: stringValue(rawSoul.tone),
    unresolvedPressure: stringValue(rawSoul.unresolvedPressure),
  };
  const monetizationPoint = stringValue(parsed.monetizationPoint);
  const requiredSkeletonElements = stringArray(parsed.requiredSkeletonElements);
  const units = parsed.units.map((raw) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return {
      number: Number(row.number),
      title: stringValue(row.title, 120) || undefined,
      cause: stringValue(row.cause),
      soulConnection: stringValue(row.soulConnection),
      dramaticMove: stringValue(row.dramaticMove),
      characterChoice: stringValue(row.characterChoice),
      consequence: stringValue(row.consequence),
      endingPressure: stringValue(row.endingPressure),
      skeletonElementsUsed: stringArray(row.skeletonElementsUsed),
      revelationPurpose: stringValue(row.revelationPurpose),
    };
  });
  const expected = expectedNumbers(orientation, units.length);
  if (
    !validLength(orientation, units.length) ||
    Object.values(storySoul).some((value) => !value) ||
    !monetizationPoint ||
    requiredSkeletonElements.length === 0 ||
    units.some((unit, index) =>
      unit.number !== expected[index] ||
      !unit.cause ||
      !unit.soulConnection ||
      !unit.dramaticMove ||
      !unit.characterChoice ||
      !unit.consequence ||
      !unit.endingPressure
    )
  ) {
    throw new Error("Creative route did not match the required story range.");
  }
  const used = new Set(units.flatMap((unit) => unit.skeletonElementsUsed).map(normalizeSkeletonElement));
  if (requiredSkeletonElements.some((element) => !used.has(normalizeSkeletonElement(element)))) {
    throw new Error("Creative route did not cover every required skeleton element.");
  }
  return { storySoul, monetizationPoint, requiredSkeletonElements, units };
}

export function parsePlotLabConnectedResponse(
  text: string,
  orientation: PlotLabSessionState["orientation"],
  version: number,
  requiredSkeletonElements: string[] = []
): PlotLabConnectedBatch {
  const parsed = extractJson(text) as Record<string, unknown>;
  if (!Array.isArray(parsed.units)) throw new Error("Connected route did not contain units.");
  const units = parsed.units.map((raw) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return {
      number: Number(row.number),
      title: stringValue(row.title, 120) || undefined,
      cause: stringValue(row.cause),
      soulConnection: stringValue(row.soulConnection),
      characterChoice: stringValue(row.characterChoice),
      consequence: stringValue(row.consequence),
      nextPressure: stringValue(row.nextPressure),
      emotionalChange: stringValue(row.emotionalChange),
      endingTurn: stringValue(row.endingTurn),
      skeletonElementsUsed: stringArray(row.skeletonElementsUsed),
      revelationPurpose: stringValue(row.revelationPurpose),
      visiblePlot: stringValue(row.visiblePlot),
    };
  });
  const expected = expectedNumbers(orientation, units.length);
  if (
    !validLength(orientation, units.length) ||
    units.some((unit, index) =>
      unit.number !== expected[index] ||
      !unit.cause ||
      !unit.soulConnection ||
      !unit.visiblePlot ||
      countSentences(unit.visiblePlot) > 2 ||
      !unit.characterChoice ||
      !unit.consequence ||
      !unit.nextPressure ||
      !unit.emotionalChange ||
      !unit.endingTurn
    )
  ) {
    throw new Error("Connected route did not match the required final format.");
  }
  const seedCoverage = Array.isArray(parsed.seedCoverage)
    ? parsed.seedCoverage.flatMap((raw) => {
        const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        const element = stringValue(row.element, 500);
        const unitNumbers = Array.isArray(row.unitNumbers)
          ? row.unitNumbers.map(Number).filter(Number.isInteger)
          : [];
        return element ? [{ element, unitNumbers }] : [];
      })
    : [];
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.map((value) => stringValue(value, 500)).filter(Boolean)
    : [];
  const missingSkeletonElement = findMissingSkeletonElement({
    required: requiredSkeletonElements,
    unitElements: units.flatMap((unit) => unit.skeletonElementsUsed),
    coverage: seedCoverage,
    allowedUnitNumbers: expected,
  });
  if (missingSkeletonElement) {
    throw new Error(`Connected route omitted required skeleton element: ${missingSkeletonElement}`);
  }
  return { format: orientation, version, units, seedCoverage, warnings };
}

export async function generateCreativeRoute(input: {
  session: PlotLabSessionState;
  messages: PlotLabMessage[];
  model: PlotLabModelChoice;
}): Promise<CreativeRoute> {
  const model = await getAIModel(input.model.modelId, input.model.thinking);
  const result = await generateText({
    model,
    system: PLOT_LAB_CREATIVE_SYSTEM_PROMPT,
    prompt: contextPacket(input.session, input.messages),
    output: creativeOutput,
  });
  return parsePlotLabCreativeResponse(
    JSON.stringify(result.output),
    input.session.orientation
  );
}

export async function connectCreativeRoute(input: {
  session: PlotLabSessionState;
  messages: PlotLabMessage[];
  creativeRoute: CreativeRoute;
  model: PlotLabModelChoice;
  version: number;
}): Promise<PlotLabConnectedBatch> {
  const model = await getAIModel(input.model.modelId, input.model.thinking);
  const request = {
    model,
    system: PLOT_LAB_CONNECTOR_SYSTEM_PROMPT,
    prompt: JSON.stringify({
      packet: JSON.parse(contextPacket(input.session, input.messages)),
      creativeRoute: input.creativeRoute,
    }),
    output: connectedOutput,
  } as const;
  const result = await generateText(request);
  try {
    return parsePlotLabConnectedResponse(
      JSON.stringify(result.output),
      input.session.orientation,
      input.version,
      input.creativeRoute.requiredSkeletonElements
    );
  } catch (validationError) {
    const expectedRange =
      input.session.orientation === "portrait"
        ? "Return exactly seven units numbered 2,3,4,5,6,7,8."
        : "Return four or five units numbered consecutively from 1.";
    const repair = await generateText({
      model,
      system: [
        "Repair the supplied Plot Lab connector JSON while preserving its EP1 Soul Spine and monetization point.",
        expectedRange,
        `Every required skeleton element must materially appear in-range: ${JSON.stringify(input.creativeRoute.requiredSkeletonElements)}.`,
        "Every unit must include number, cause, soulConnection, characterChoice, consequence, nextPressure, emotionalChange, endingTurn, skeletonElementsUsed, revelationPurpose, and a visiblePlot of no more than two sentences.",
        "Keep titles when present. Return only the repaired structured object.",
      ].join("\n"),
      prompt: JSON.stringify(result.output),
      output: connectedOutput,
    });
    try {
      return parsePlotLabConnectedResponse(
        JSON.stringify(repair.output),
        input.session.orientation,
        input.version,
        input.creativeRoute.requiredSkeletonElements
      );
    } catch {
      throw validationError;
    }
  }
}

export async function generateRealConversationTurn(input: {
  session: PlotLabSessionState;
  messages: PlotLabMessage[];
  currentBatch: PlotLabConnectedBatch;
  model: PlotLabModelChoice;
}): Promise<PlotLabConversationTurn> {
  const model = await getAIModel(input.model.modelId, input.model.thinking);
  const result = await generateText({
    model,
    system: PLOT_LAB_CONVERSATION_SYSTEM_PROMPT,
    prompt: JSON.stringify({
      packet: JSON.parse(contextPacket(input.session, input.messages)),
      currentBatch: input.currentBatch,
    }),
    output: conversationOutput,
  });
  const parsed = result.output as unknown as Record<string, unknown>;
  const kind = parsed.kind === "mutation_proposal" ? "mutation_proposal" : "discussion";
  const turn: PlotLabConversationTurn = {
    kind,
    message: stringValue(parsed.message, 2_000),
    instruction: stringValue(parsed.instruction, 2_000),
    targetUnitNumbers: Array.isArray(parsed.targetUnitNumbers)
      ? parsed.targetUnitNumbers.map(Number).filter(Number.isInteger)
      : [],
    downstreamUnitNumbers: Array.isArray(parsed.downstreamUnitNumbers)
      ? parsed.downstreamUnitNumbers.map(Number).filter(Number.isInteger)
      : [],
    explanation: stringValue(parsed.explanation, 2_000),
  };
  if (!turn.message) throw new Error("Levi's follow-up response was incomplete.");
  if (
    kind === "mutation_proposal" &&
    (!turn.instruction || turn.targetUnitNumbers.length === 0 || !turn.explanation)
  ) {
    throw new Error("Levi's change proposal was incomplete.");
  }
  return turn;
}

export const PLOT_LAB_PROMPT_VERSIONS = {
  interviewer: PLOT_LAB_INTERVIEWER_PROMPT_VERSION,
  creative: PLOT_LAB_CREATIVE_PROMPT_VERSION,
  connector: PLOT_LAB_CONNECTOR_PROMPT_VERSION,
  conversation: PLOT_LAB_CONVERSATION_PROMPT_VERSION,
};
