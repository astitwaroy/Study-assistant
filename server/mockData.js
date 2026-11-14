/**
 * Hand-written study material for the photosynthesis sample, so demo mode
 * shows realistic content. Anything else is built from the pasted notes.
 */

export const PHOTOSYNTHESIS = {
  title: 'Photosynthesis basics',
  flashcards: [
    { front: 'Where in the plant cell does photosynthesis take place?', back: 'In chloroplasts, mostly in the mesophyll cells of the leaf.' },
    { front: 'What is the overall equation for photosynthesis?', back: '6CO₂ + 6H₂O + light energy → C₆H₁₂O₆ + 6O₂' },
    { front: 'Where do the light-dependent reactions happen?', back: 'In the thylakoid membranes of the chloroplast.' },
    { front: 'Why do leaves look green?', back: 'Chlorophyll absorbs mostly red and blue light and reflects green light.' },
    { front: 'What is photolysis?', back: 'The splitting of water during the light-dependent reactions. It releases oxygen as a by-product.' },
    { front: 'Which two energy carriers do the light-dependent reactions produce?', back: 'ATP and NADPH.' },
    { front: 'Where does the Calvin cycle take place?', back: 'In the stroma of the chloroplast.' },
    { front: 'What does RuBisCO do?', back: 'It fixes carbon dioxide by attaching it to RuBP at the start of the Calvin cycle.' },
    { front: 'What is G3P?', back: 'A three-carbon sugar made in the Calvin cycle. The plant uses it to build glucose and other molecules.' },
    { front: 'What powers the reduction of fixed carbon in the Calvin cycle?', back: 'ATP and NADPH from the light-dependent reactions.' },
    { front: 'Name three factors that limit the rate of photosynthesis.', back: 'Light intensity, carbon dioxide concentration and temperature.' },
    { front: 'What do stomata and guard cells do?', back: 'Stomata let CO₂ in and O₂ and water vapour out. Guard cells open and close them.' },
  ],
  quiz: [
    {
      type: 'mcq',
      question: 'In which part of the chloroplast do the light-dependent reactions occur?',
      options: ['Stroma', 'Thylakoid membranes', 'Outer membrane', 'Cytoplasm'],
      answerIndex: 1,
      explanation: 'The thylakoid membranes hold the chlorophyll and electron carriers that capture light energy.',
    },
    {
      type: 'mcq',
      question: 'Which gas is released as a by-product when water is split?',
      options: ['Carbon dioxide', 'Nitrogen', 'Oxygen', 'Hydrogen'],
      answerIndex: 2,
      explanation: 'Photolysis splits water into hydrogen ions, electrons and oxygen, and the oxygen is released.',
    },
    {
      type: 'mcq',
      question: 'What does the enzyme RuBisCO do?',
      options: ['Splits water molecules', 'Fixes CO₂ onto RuBP', 'Makes ATP', 'Absorbs red light'],
      answerIndex: 1,
      explanation: 'RuBisCO attaches carbon dioxide to RuBP, the first step of the Calvin cycle.',
    },
    {
      type: 'true_false',
      statement: 'The Calvin cycle takes place in the stroma.',
      answer: true,
      explanation: 'The light-independent reactions happen in the stroma, the fluid around the thylakoids.',
    },
    {
      type: 'mcq',
      question: 'Which colours of light does chlorophyll absorb best?',
      options: ['Green and yellow', 'Red and blue', 'Only ultraviolet', 'Infrared'],
      answerIndex: 1,
      explanation: 'Chlorophyll absorbs red and blue light and reflects green, so leaves appear green.',
    },
    {
      type: 'mcq',
      question: 'Which products of the light-dependent reactions does the Calvin cycle use?',
      options: ['ATP and NADPH', 'Glucose and oxygen', 'Water and CO₂', 'RuBP and G3P'],
      answerIndex: 0,
      explanation: 'ATP supplies energy and NADPH supplies the electrons that reduce fixed carbon into G3P.',
    },
    {
      type: 'true_false',
      statement: 'Photosynthesis converts chemical energy into light energy.',
      answer: false,
      explanation: 'It is the other way round: light energy is converted into chemical energy stored in glucose.',
    },
    {
      type: 'mcq',
      question: 'How many carbon atoms does G3P have?',
      options: ['Two', 'Three', 'Five', 'Six'],
      answerIndex: 1,
      explanation: 'G3P (glyceraldehyde 3-phosphate) is a three-carbon sugar.',
    },
    {
      type: 'mcq',
      question: 'What do guard cells control?',
      options: ['The opening of stomata', 'The splitting of water', 'Chlorophyll production', 'The speed of the Calvin cycle'],
      answerIndex: 0,
      explanation: 'Guard cells open and close stomata, which controls gas exchange and water loss.',
    },
    {
      type: 'mcq',
      question: 'Which of these is not one of the limiting factors listed in the notes?',
      options: ['Light intensity', 'CO₂ concentration', 'Temperature', 'Soil pH'],
      answerIndex: 3,
      explanation: 'The notes list light intensity, CO₂ concentration and temperature.',
    },
    {
      type: 'true_false',
      statement: 'The oxygen released by photosynthesis comes from carbon dioxide.',
      answer: false,
      explanation: 'The oxygen comes from water split during photolysis, not from CO₂.',
    },
    {
      type: 'mcq',
      question: 'Which sugar does the overall photosynthesis equation produce?',
      options: ['Sucrose', 'Glucose', 'Starch', 'Fructose'],
      answerIndex: 1,
      explanation: 'The equation produces one glucose molecule (C₆H₁₂O₆) for every six CO₂ molecules.',
    },
  ],
  extraFlashcards: [
    { front: 'What is RuBP?', back: 'Ribulose bisphosphate, the five-carbon molecule that RuBisCO attaches CO₂ to.' },
    { front: 'What happens to the rate of photosynthesis if it gets too hot?', back: 'It falls, because enzymes such as RuBisCO start to denature.' },
  ],
  extraQuiz: [
    {
      type: 'mcq',
      question: 'Which molecule does RuBisCO attach CO₂ to?',
      options: ['Glucose', 'RuBP', 'NADPH', 'ATP'],
      answerIndex: 1,
      explanation: 'RuBisCO fixes CO₂ onto RuBP (ribulose bisphosphate), a five-carbon molecule.',
    },
    {
      type: 'true_false',
      statement: 'Increasing light intensity always increases the rate of photosynthesis.',
      answer: false,
      explanation: 'Past a point another factor, such as CO₂ concentration or temperature, becomes limiting.',
    },
  ],
};
