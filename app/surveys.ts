export type SurveyPreset = {
  id: string;
  name: string;
  question: string;
  options: string[];
};

export const MAX_SURVEY_OPTIONS = 8;

export const SURVEY_PRESETS: SurveyPreset[] = [
  {
    id: "heard",
    name: "How did you hear about us?",
    question: "How did you hear about us?",
    options: [
      "Instagram",
      "TikTok",
      "Google search",
      "A friend",
      "Email",
      "Other",
    ],
  },
  {
    id: "stopped",
    name: "What nearly stopped you from buying?",
    question: "What nearly stopped you from buying today?",
    options: [
      "Shipping cost",
      "Price",
      "Not sure it was right for me",
      "Not enough reviews",
      "Nothing, it was easy",
      "Other",
    ],
  },
  {
    id: "first",
    name: "Is this your first order?",
    question: "Is this your first order with us?",
    options: ["Yes, first time", "No, I have ordered before"],
  },
  {
    id: "recommend",
    name: "How likely are you to recommend us? (0 to 10)",
    question: "How likely are you to recommend us to a friend?",
    options: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
  },
];

export const DEFAULT_PRESET = SURVEY_PRESETS[0];