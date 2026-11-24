import { generateText, jsonSchema, Output } from "ai";
import { getAIModel, getConfiguredProviders } from "@/lib/ai/providers";
import type {
  PlotLabConnectedBatch,
  PlotLabEndpointCandidate,
  PlotLabMessage,
  PlotLabOrchestratorDecision,
  PlotLabQAResult,
  PlotLabRouteCandidate,
  PlotLabSessionState,
  PlotLabSourceTruthBrief,
  PlotLabSpecialistBrief,
  PlotLabStoryBrief,
  PlotLabStorySoul,
} from "@/lib/plot-lab-v2/contracts";
import {
  PLOT_LAB_CONNECTOR_PROMPT_VERSION,
  PLOT_LAB_CONNECTOR_SYSTEM_PROMPT,
  PLOT_LAB_CONVERSATION_PROMPT_VERSION,
  PLOT_LAB_CONVERSATION_SYSTEM_PROMPT,
  PLOT_LAB_ENDPOINT_EXPLORER_SYSTEM_PROMPT,
  PLOT_LAB_HARNESS_PROMPT_VERSION,
  PLOT_LAB_HOLISTIC_QA_SYSTEM_PROMPT,
  PLOT_LAB_ORCHESTRATOR_SYSTEM_PROMPT,
  PLOT_LAB_ROUTE_EXPLORER_SYSTEM_PROMPT,
  PLOT_LAB_SOURCE_TRUTH_SYSTEM_PROMPT,
  PLOT_LAB_SPECIALIST_SYSTEM_PROMPTS,
  PLOT_LAB_TARGETED_REPAIR_SYSTEM_PROMPT,
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
  destinationClock: string;
  relationshipDestination: string;
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
  repairScope: "connector" | "unit" | "route" | "destination";
}

const storySoulSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["premise", "characterEngine", "centralRelationship", "emotionalPromise", "tone", "unresolvedPressure"],
  properties: {
    premise: { type: "string" as const }, characterEngine: { type: "string" as const }, centralRelationship: { type: "string" as const },
    emotionalPromise: { type: "string" as const }, tone: { type: "string" as const }, unresolvedPressure: { type: "string" as const },
  },
};

const sourceTruthOutput = Output.object({
  name: "plot_lab_source_truth",
  description: "Immutable source truth for an orchestrated Plot Lab run.",
  schema: jsonSchema<PlotLabSourceTruthBrief>({
    type: "object", additionalProperties: false,
    required: ["episode1Soul", "canonFacts", "requiredSkeletonElements", "monetizationPoint", "characterFidelity", "unresolvedQuestions"],
    properties: {
      episode1Soul: storySoulSchema,
      canonFacts: { type: "array", items: { type: "string" } },
      requiredSkeletonElements: { type: "array", minItems: 1, items: { type: "string" } },
      monetizationPoint: { type: "string" },
      characterFidelity: { type: "array", items: { type: "string" } },
      unresolvedQuestions: { type: "array", items: { type: "string" } },
    },
  }),
});

const endpointOutput = Output.object({
  name: "plot_lab_endpoint_candidates",
  description: "Exactly two final-turn candidates.",
  schema: jsonSchema<{ candidates: PlotLabEndpointCandidate[] }>({
    type: "object", additionalProperties: false, required: ["candidates"],
    properties: { candidates: { type: "array", minItems: 2, maxItems: 2, items: {
      type: "object", additionalProperties: false, required: ["id", "finalTurn", "visual", "emotionalCost", "causalRequirements"],
      properties: { id: { type: "string" }, finalTurn: { type: "string" }, visual: { type: "string" }, emotionalCost: { type: "string" }, causalRequirements: { type: "array", items: { type: "string" } } },
    } } },
  }),
});

const routeOutput = Output.object({
  name: "plot_lab_route_candidates",
  description: "Exactly two compact causal route candidates.",
  schema: jsonSchema<{ candidates: PlotLabRouteCandidate[] }>({
    type: "object", additionalProperties: false, required: ["candidates"],
    properties: { candidates: { type: "array", minItems: 2, maxItems: 2, items: {
      type: "object", additionalProperties: false, required: ["id", "thesis", "endpointCandidateId", "unitSpine"],
      properties: { id: { type: "string" }, thesis: { type: "string" }, endpointCandidateId: { type: "string" }, unitSpine: { type: "array", minItems: 4, maxItems: 7, items: {
        type: "object", additionalProperties: false, required: ["number", "purpose", "cause", "choice", "changedState", "outgoingPressure"],
        properties: { number: { type: "integer" }, purpose: { type: "string" }, cause: { type: "string" }, choice: { type: "string" }, changedState: { type: "string" }, outgoingPressure: { type: "string" } },
      } } },
    } } },
  }),
});

const decisionOutput = Output.object({
  name: "plot_lab_orchestrator_decision",
  description: "Levi's route selection and conditional specialist plan.",
  schema: jsonSchema<PlotLabOrchestratorDecision>({
    type: "object", additionalProperties: false, required: ["selectedRouteId", "rationale", "qualityDefinition", "specialistNeeds"],
    properties: {
      selectedRouteId: { type: "string" }, rationale: { type: "string" }, qualityDefinition: { type: "array", items: { type: "string" } },
      specialistNeeds: { type: "object", additionalProperties: false, required: ["characterRelationship", "oppositionPressure", "timeLocationWorld"], properties: {
        characterRelationship: { type: "object", additionalProperties: false, required: ["needed", "reason"], properties: { needed: { type: "boolean" }, reason: { type: "string" } } },
        oppositionPressure: { type: "object", additionalProperties: false, required: ["needed", "reason"], properties: { needed: { type: "boolean" }, reason: { type: "string" } } },
        timeLocationWorld: { type: "object", additionalProperties: false, required: ["needed", "reason"], properties: { needed: { type: "boolean" }, reason: { type: "string" } } },
      } },
    },
  }),
});

const specialistOutput = Output.object({
  name: "plot_lab_specialist_brief", description: "A concise optional specialist brief.",
  schema: jsonSchema<PlotLabSpecialistBrief>({ type: "object", additionalProperties: false, required: ["role", "guidance", "risks"], properties: {
    role: { type: "string", enum: ["character_relationship", "opposition_pressure", "time_location_world"] },
    guidance: { type: "array", items: { type: "string" } }, risks: { type: "array", items: { type: "string" } },
  } }),
});

const qaOutput = Output.object({
  name: "plot_lab_holistic_qa", description: "One non-blocking holistic quality judgment.",
  schema: jsonSchema<PlotLabQAResult>({ type: "object", additionalProperties: false, required: ["verdict", "strengths", "primaryIssue", "repairInstruction", "owner", "affectedUnitNumbers"], properties: {
    verdict: { type: "string", enum: ["strong", "repair_recommended"] }, strengths: { type: "array", items: { type: "string" } },
    primaryIssue: { type: "string" }, repairInstruction: { type: "string" }, owner: { type: "string", enum: ["creative_author", "connector"] },
    affectedUnitNumbers: { type: "array", items: { type: "integer" } },
  } }),
});

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
    required: [
      "storySoul",
      "monetizationPoint",
      "destinationClock",
      "relationshipDestination",
      "requiredSkeletonElements",
      "units",
    ],
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
      destinationClock: { type: "string" },
      relationshipDestination: { type: "string" },
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
            "episodeFunction",
            "timePhase",
            "locationFunction",
            "dramaticMove",
            "characterChoice",
            "consequence",
            "endingPressure",
            "cliffhangerType",
            "relationshipChange",
            "antagonistPressure",
            "fidelityProof",
            "skeletonElementsUsed",
            "revelationPurpose",
          ],
          properties: {
            number: { type: "integer" },
            title: { type: "string" },
            cause: { type: "string" },
            soulConnection: { type: "string" },
            episodeFunction: { type: "string" },
            timePhase: { type: "string" },
            locationFunction: { type: "string" },
            dramaticMove: { type: "string" },
            characterChoice: { type: "string" },
            consequence: { type: "string" },
            endingPressure: { type: "string" },
            cliffhangerType: { type: "string" },
            relationshipChange: { type: "string" },
            antagonistPressure: { type: "string" },
            fidelityProof: { type: "string" },
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
            "episodeFunction",
            "timePhase",
            "locationFunction",
            "characterChoice",
            "consequence",
            "nextPressure",
            "emotionalChange",
            "endingTurn",
            "cliffhangerType",
            "relationshipChange",
            "antagonistPressure",
            "fidelityProof",
            "skeletonElementsUsed",
            "revelationPurpose",
            "visiblePlot",
          ],
          properties: {
            number: { type: "integer" },
            title: { type: "string" },
            cause: { type: "string" },
            soulConnection: { type: "string" },
            episodeFunction: { type: "string" },
            timePhase: { type: "string" },
            locationFunction: { type: "string" },
            characterChoice: { type: "string" },
            consequence: { type: "string" },
            nextPressure: { type: "string" },
            emotionalChange: { type: "string" },
            endingTurn: { type: "string" },
            cliffhangerType: { type: "string" },
            relationshipChange: { type: "string" },
            antagonistPressure: { type: "string" },
            fidelityProof: { type: "string" },
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
      "repairScope",
    ],
    properties: {
      kind: { type: "string", enum: ["discussion", "mutation_proposal"] },
      message: { type: "string" },
      instruction: { type: "string" },
      targetUnitNumbers: { type: "array", items: { type: "integer" } },
      downstreamUnitNumbers: { type: "array", items: { type: "integer" } },
      explanation: { type: "string" },
      repairScope: { type: "string", enum: ["connector", "unit", "route", "destination"] },
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
  episodeFunction: string;
  timePhase: string;
  locationFunction: string;
  dramaticMove: string;
  characterChoice: string;
  consequence: string;
  endingPressure: string;
  cliffhangerType: string;
  relationshipChange: string;
  antagonistPressure: string;
  fidelityProof: string;
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
  const destinationClock = stringValue(parsed.destinationClock) || monetizationPoint;
  const relationshipDestination = stringValue(parsed.relationshipDestination) || "The primary relationship becomes costly and consequential but remains unresolved.";
  const requiredSkeletonElements = stringArray(parsed.requiredSkeletonElements);
  const units = parsed.units.map((raw) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const dramaticMove = stringValue(row.dramaticMove);
    const characterChoice = stringValue(row.characterChoice) || dramaticMove;
    const consequence = stringValue(row.consequence) || stringValue(row.endingPressure) || dramaticMove;
    const endingPressure = stringValue(row.endingPressure) || consequence;
    return {
      number: Number(row.number),
      title: stringValue(row.title, 120) || undefined,
      cause: stringValue(row.cause) || dramaticMove,
      soulConnection: stringValue(row.soulConnection) || "Continues the established Episode 1 story engine.",
      episodeFunction: stringValue(row.episodeFunction) || "Advance the dominant story pressure through a distinct dramatic job.",
      timePhase: stringValue(row.timePhase) || "Continue from the incoming event, then advance only when the changed state permits it.",
      locationFunction: stringValue(row.locationFunction) || "Use the established location to change pressure, privacy, authority, or available choices.",
      dramaticMove,
      characterChoice,
      consequence,
      endingPressure,
      cliffhangerType: stringValue(row.cliffhangerType) || "immediate irreversible turn",
      relationshipChange: stringValue(row.relationshipChange) || "The central relationship changes through the episode's consequential behavior.",
      antagonistPressure: stringValue(row.antagonistPressure) || "Deliberate breathing space; existing opposition remains active without a new attack.",
      fidelityProof: stringValue(row.fidelityProof) || "The characters pursue the episode through behavior established in Episode 1.",
      skeletonElementsUsed: stringArray(row.skeletonElementsUsed),
      revelationPurpose: stringValue(row.revelationPurpose),
    };
  });
  const expected = expectedNumbers(orientation, units.length);
  if (
    !validLength(orientation, units.length) ||
    units.some((unit, index) =>
      unit.number !== expected[index] ||
      !unit.dramaticMove
    )
  ) {
    throw new Error("Creative route did not match the required story range.");
  }
  return {
    storySoul,
    monetizationPoint,
    destinationClock,
    relationshipDestination,
    requiredSkeletonElements,
    units,
  };
}

export function parsePlotLabConnectedResponse(
  text: string,
  orientation: PlotLabSessionState["orientation"],
  version: number
): PlotLabConnectedBatch {
  const parsed = extractJson(text) as Record<string, unknown>;
  if (!Array.isArray(parsed.units)) throw new Error("Connected route did not contain units.");
  const units = parsed.units.map((raw) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const visiblePlot = stringValue(row.visiblePlot);
    const characterChoice = stringValue(row.characterChoice) || stringValue(row.cause) || visiblePlot;
    const endingTurn = stringValue(row.endingTurn) || stringValue(row.nextPressure);
    const consequence = stringValue(row.consequence) || endingTurn || visiblePlot;
    return {
      number: Number(row.number),
      title: stringValue(row.title, 120) || undefined,
      cause: stringValue(row.cause) || characterChoice,
      soulConnection: stringValue(row.soulConnection) || "Continues the established Episode 1 story engine.",
      episodeFunction: stringValue(row.episodeFunction) || "Advance the episode through a distinct dramatic job.",
      timePhase: stringValue(row.timePhase) || "Resolve the incoming event before any justified time advance.",
      locationFunction: stringValue(row.locationFunction) || "Use place to change pressure, privacy, authority, or available choices.",
      characterChoice,
      consequence,
      nextPressure: stringValue(row.nextPressure) || endingTurn,
      emotionalChange: stringValue(row.emotionalChange) || "The changed pressure alters what the character can risk next.",
      endingTurn,
      cliffhangerType: stringValue(row.cliffhangerType) || "immediate irreversible turn",
      relationshipChange: stringValue(row.relationshipChange) || "The central relationship changes through consequential behavior.",
      antagonistPressure: stringValue(row.antagonistPressure) || "Deliberate breathing space; existing opposition remains active without a new attack.",
      fidelityProof: stringValue(row.fidelityProof) || "The characters act through traits and power styles established in Episode 1.",
      skeletonElementsUsed: stringArray(row.skeletonElementsUsed),
      revelationPurpose: stringValue(row.revelationPurpose),
      visiblePlot,
    };
  });
  const expected = expectedNumbers(orientation, units.length);
  if (
    !validLength(orientation, units.length) ||
    units.some((unit, index) =>
      unit.number !== expected[index] ||
      !unit.visiblePlot
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
  return { format: orientation, version, units, seedCoverage, warnings };
}

async function structuredCall<T>(input: {
  model: PlotLabModelChoice;
  system: string;
  prompt: unknown;
  output: Parameters<typeof generateText>[0]["output"];
}): Promise<T> {
  const model = await getAIModel(input.model.modelId, input.model.thinking);
  const result = await generateText({
    model,
    system: input.system,
    prompt: typeof input.prompt === "string" ? input.prompt : JSON.stringify(input.prompt),
    output: input.output,
  });
  return result.output as T;
}

export async function generateSourceTruth(input: {
  session: PlotLabSessionState; messages: PlotLabMessage[]; model: PlotLabModelChoice;
}): Promise<PlotLabSourceTruthBrief> {
  return structuredCall({ model: input.model, system: PLOT_LAB_SOURCE_TRUTH_SYSTEM_PROMPT, prompt: contextPacket(input.session, input.messages), output: sourceTruthOutput });
}

export async function exploreEndpoints(input: {
  sourceTruth: PlotLabSourceTruthBrief; orientation: PlotLabSessionState["orientation"]; model: PlotLabModelChoice;
  revisionInstruction?: string;
}): Promise<PlotLabEndpointCandidate[]> {
  const result = await structuredCall<{ candidates: PlotLabEndpointCandidate[] }>({ model: input.model, system: PLOT_LAB_ENDPOINT_EXPLORER_SYSTEM_PROMPT, prompt: input, output: endpointOutput });
  if (result.candidates.length !== 2) throw new Error("Endpoint exploration did not return two candidates.");
  return result.candidates;
}

export async function exploreRoutes(input: {
  sourceTruth: PlotLabSourceTruthBrief; endpointCandidates: PlotLabEndpointCandidate[]; orientation: PlotLabSessionState["orientation"]; model: PlotLabModelChoice;
  revisionInstruction?: string;
}): Promise<PlotLabRouteCandidate[]> {
  const result = await structuredCall<{ candidates: PlotLabRouteCandidate[] }>({ model: input.model, system: PLOT_LAB_ROUTE_EXPLORER_SYSTEM_PROMPT, prompt: input, output: routeOutput });
  if (result.candidates.length !== 2) throw new Error("Route exploration did not return two candidates.");
  for (const route of result.candidates) {
    const numbers = expectedNumbers(input.orientation, route.unitSpine.length);
    if (!validLength(input.orientation, route.unitSpine.length) || route.unitSpine.some((unit, index) => unit.number !== numbers[index])) {
      throw new Error("Route exploration did not match the required story range.");
    }
  }
  return result.candidates;
}

export async function selectRouteAndSpecialists(input: {
  sourceTruth: PlotLabSourceTruthBrief; endpointCandidates: PlotLabEndpointCandidate[]; routeCandidates: PlotLabRouteCandidate[]; model: PlotLabModelChoice;
  revisionInstruction?: string;
}): Promise<PlotLabOrchestratorDecision> {
  const decision = await structuredCall<PlotLabOrchestratorDecision>({ model: input.model, system: PLOT_LAB_ORCHESTRATOR_SYSTEM_PROMPT, prompt: input, output: decisionOutput });
  if (!input.routeCandidates.some((route) => route.id === decision.selectedRouteId)) throw new Error("Levi selected an unknown route candidate.");
  return decision;
}

export async function generateSpecialistBrief(input: {
  role: PlotLabSpecialistBrief["role"];
  sourceTruth: PlotLabSourceTruthBrief;
  selectedRoute: PlotLabRouteCandidate;
  reason: string;
  model: PlotLabModelChoice;
}): Promise<PlotLabSpecialistBrief> {
  const result = await structuredCall<PlotLabSpecialistBrief>({ model: input.model, system: PLOT_LAB_SPECIALIST_SYSTEM_PROMPTS[input.role], prompt: input, output: specialistOutput });
  return { ...result, role: input.role };
}

export async function runHolisticQA(input: {
  sourceTruth: PlotLabSourceTruthBrief;
  selectedRoute: PlotLabRouteCandidate;
  creativeRoute: CreativeRoute;
  model: PlotLabModelChoice;
}): Promise<PlotLabQAResult> {
  return structuredCall({ model: input.model, system: PLOT_LAB_HOLISTIC_QA_SYSTEM_PROMPT, prompt: input, output: qaOutput });
}

export async function repairCreativeRoute(input: {
  session: PlotLabSessionState;
  sourceTruth: PlotLabSourceTruthBrief;
  creativeRoute: CreativeRoute;
  qa: PlotLabQAResult;
  model: PlotLabModelChoice;
}): Promise<CreativeRoute> {
  const result = await structuredCall<CreativeRoute>({ model: input.model, system: PLOT_LAB_TARGETED_REPAIR_SYSTEM_PROMPT, prompt: input, output: creativeOutput });
  return parsePlotLabCreativeResponse(JSON.stringify(result), input.session.orientation);
}

export async function generateCreativeRoute(input: {
  session: PlotLabSessionState;
  messages: PlotLabMessage[];
  model: PlotLabModelChoice;
  orchestration?: {
    sourceTruth: PlotLabSourceTruthBrief;
    endpointCandidates: PlotLabEndpointCandidate[];
    routeCandidates: PlotLabRouteCandidate[];
    decision: PlotLabOrchestratorDecision;
    specialistBriefs: PlotLabSpecialistBrief[];
    revisionInstruction?: string;
  };
}): Promise<CreativeRoute> {
  const model = await getAIModel(input.model.modelId, input.model.thinking);
  const result = await generateText({
    model,
    system: PLOT_LAB_CREATIVE_SYSTEM_PROMPT,
    prompt: JSON.stringify({ packet: JSON.parse(contextPacket(input.session, input.messages)), orchestration: input.orchestration ?? null }),
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
  revisionInstruction?: string;
}): Promise<PlotLabConnectedBatch> {
  const model = await getAIModel(input.model.modelId, input.model.thinking);
  const request = {
    model,
    system: PLOT_LAB_CONNECTOR_SYSTEM_PROMPT,
    prompt: JSON.stringify({
      packet: JSON.parse(contextPacket(input.session, input.messages)),
      creativeRoute: input.creativeRoute,
      revisionInstruction: input.revisionInstruction ?? null,
    }),
    output: connectedOutput,
  } as const;
  const result = await generateText(request);
  try {
    return parsePlotLabConnectedResponse(
      JSON.stringify(result.output),
      input.session.orientation,
      input.version
    );
  } catch (validationError) {
    const expectedRange =
      input.session.orientation === "portrait"
        ? "Return exactly seven units numbered 2,3,4,5,6,7,8."
        : "Return four or five units numbered consecutively from 1.";
    const repair = await generateText({
      model,
      system: [
        "Repair only the transport structure of the supplied Plot Lab connector JSON while preserving its story, EP1 Soul Spine, and monetization point.",
        expectedRange,
        `Keep the supplied skeleton coverage intact: ${JSON.stringify(input.creativeRoute.requiredSkeletonElements)}.`,
        "Every unit must include number, cause, soulConnection, episodeFunction, timePhase, locationFunction, characterChoice, consequence, nextPressure, emotionalChange, endingTurn, cliffhangerType, relationshipChange, antagonistPressure, fidelityProof, skeletonElementsUsed, revelationPurpose, and visiblePlot.",
        input.session.orientation === "portrait"
          ? "Preserve each existing visiblePlot. If one is missing, reconstruct it as two or three natural sentences that retain the causal episode purpose and the immediate outgoing turn; do not force literal Because/Then wording."
          : "Every visiblePlot must be two or three concise natural sentences.",
        "Keep titles when present. Return only the repaired structured object.",
      ].join("\n"),
      prompt: JSON.stringify(result.output),
      output: connectedOutput,
    });
    try {
      return parsePlotLabConnectedResponse(
        JSON.stringify(repair.output),
        input.session.orientation,
        input.version
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
    repairScope:
      parsed.repairScope === "connector" || parsed.repairScope === "unit" || parsed.repairScope === "destination"
        ? parsed.repairScope
        : "route",
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
  harness: PLOT_LAB_HARNESS_PROMPT_VERSION,
};
