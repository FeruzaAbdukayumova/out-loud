/** Texts that come with the app: short, everyday words, present tense. */

export interface Text {
  id: string
  title: string
  body: string
  /** Only the built-in texts have a level. */
  level?: string
  /** Texts the reader added; null for built-in ones. */
  createdAt: number | null
}

export const BUILT_IN: Text[] = [
  {
    id: 'morning',
    title: 'My morning',
    level: 'Level 1',
    createdAt: null,
    body: "I wake up at seven o'clock. I open the window and look outside. The sky is blue today. I drink a cup of tea and eat some bread. Then I walk to school with my friend.",
  },
  {
    id: 'shop',
    title: 'At the shop',
    level: 'Level 1',
    createdAt: null,
    body: 'The shop is near my house. I buy milk, eggs and apples. The apples are red and sweet. I pay with a card. The woman gives me a bag. I say thank you and go home.',
  },
  {
    id: 'family',
    title: 'My family',
    level: 'Level 2',
    createdAt: null,
    body: 'My family is not very big. I live with my mother, my father and my little sister. My sister is six years old. She likes to draw animals. On Sunday we cook lunch together and watch a film.',
  },
  {
    id: 'weather',
    title: 'The weather',
    level: 'Level 2',
    createdAt: null,
    body: 'Today the weather is cold and windy. Yesterday it was warm and sunny. I wear a jacket and a scarf when I go out. In winter it often snows here. Children play in the snow and build a snowman.',
  },
]

/** Longer texts are tiring to read in one go and slow to align on a phone. */
export const MAX_WORDS = 300
export const MAX_TITLE = 40
