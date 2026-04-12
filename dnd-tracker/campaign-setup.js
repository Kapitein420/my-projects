/* ============================================================
   Campaign Setup Script — Run once to populate characters & session
   Based on the Kapitein Goorlel campaign artwork
   Delete this file after importing.
   ============================================================ */

function importKapiteinCampaign() {
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

  // ── CHARACTERS ──────────────────────────────────────────────
  const campaignChars = [
    {
      id: uid(),
      name: 'Kapitein Goorlel',
      icon: '',
      imageUrl: '',
      player: 'DM NPC / Player',
      class: 'Fighter',
      subclass: 'Champion',
      level: 8,
      race: 'Hill Dwarf',
      background: 'Soldier',
      alignment: 'Lawful Neutral',
      str: 18, dex: 12, con: 16, int: 10, wis: 13, cha: 8,
      passive: 13,
      maxHp: 76, currentHp: 76, tempHp: 0,
      ac: 18, initiative: 1, speed: 25,
      hitDice: 'd10',
      saves: { str: true, dex: false, con: true, int: false, wis: false, cha: false },
      skills: { athletics: true, intimidation: true, perception: true, survival: true },
      attacks: 'Warhammer: +7 to hit, 1d8+4 bludgeoning (versatile 1d10+4)\nHandaxe: +7 to hit, 1d6+4 slashing (thrown 20/60)',
      equipment: 'Warhammer, Chain Mail, Shield, Handaxe x2, Explorer\'s Pack, Rank insignia, Trophy from fallen foe (beholder tooth)',
      traits: 'I can stare down a hell hound without flinching. I face problems head-on.',
      ideals: 'Responsibility. I do what I must and obey just authority.',
      bonds: 'I fight for those who cannot fight for themselves. My company of soldiers is my family.',
      flaws: 'I\'d rather eat my armor than admit I\'m wrong. I have little respect for anyone not a warrior.',
      features: 'Second Wind, Action Surge, Extra Attack, Improved Critical (19-20), Dwarven Resilience, Dwarven Toughness',
      backstory: 'Kapitein Goorlel earned his title in the siege of Ironhold, where his company held the gates against a tide of aberrations. When a beholder appeared above the battlements, Goorlel stood his ground while his comrades fled. He lost an eye to its ray but drove it back with a thrown warhammer. Now he hunts the creature across the Underdark, seeking to finish what he started.',
      notes: 'Signature move: throwing his warhammer at flying enemies while roaring a dwarven war cry. Has a glass eye made from beholder-eye crystal.',
      proficiencies: 'All armor, shields, simple weapons, martial weapons, Smith\'s tools, Vehicles (land), Dice set',
      conditions: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    },
    {
      id: uid(),
      name: 'Battle Boy',
      icon: '',
      imageUrl: '',
      player: 'Player',
      class: 'Bard',
      subclass: 'College of Valor',
      level: 7,
      race: 'Halfling',
      background: 'Entertainer',
      alignment: 'Chaotic Good',
      str: 8, dex: 16, con: 12, int: 14, wis: 10, cha: 18,
      passive: 10,
      maxHp: 45, currentHp: 45, tempHp: 0,
      ac: 15, initiative: 3, speed: 25,
      hitDice: 'd8',
      saves: { str: false, dex: true, con: false, int: false, wis: false, cha: true },
      skills: { performance: true, persuasion: true, deception: true, perception: true, acrobatics: true },
      attacks: 'Bone Flute (Spellcasting Focus): Spell Attack +7\nShort Sword: +6 to hit, 1d6+3 piercing',
      equipment: 'Bone Flute (spellcasting focus), Short Sword, Leather Armor, Entertainer\'s Pack, Disguise Kit, Love letter from a secret admirer',
      traits: 'I know a story relevant to almost every situation. I change my mood as quickly as I change key in a song.',
      ideals: 'Creativity. The world is in need of new ideas and bold action.',
      bonds: 'My bone flute was carved from the thighbone of a hill giant I defeated with nothing but music and wit.',
      flaws: 'I can\'t resist a pretty face, or an ugly one with a good story. I once insulted a queen\'s singing and had to flee the country.',
      features: 'Bardic Inspiration (d8), Jack of All Trades, Song of Rest (d6), Expertise (Performance, Persuasion), Combat Inspiration, Extra Attack, Halfling Luck, Brave, Nimble',
      backstory: 'Nobody knows Battle Boy\'s real name - he earned his moniker after using Shatter to collapse a goblin cave while playing a jaunty tune on his bone flute. The elderly halfling has wandered the realms for decades, collecting stories and causing chaos in equal measure. His music has been banned in three kingdoms, praised in two, and is considered a war crime in one. He joined Goorlel\'s company after the captain saved him from a bar fight with twelve angry dwarves who didn\'t appreciate his "experimental" music.',
      notes: 'Signature spell: Shatter (cast through bone flute). Has a habit of narrating combat as it happens. Enemies hate this.',
      proficiencies: 'Light armor, simple weapons, hand crossbows, longswords, rapiers, shortswords, Bone Flute, Lute, Drum, Disguise kit',
      conditions: [],
      createdAt: Date.now() + 1,
      updatedAt: Date.now() + 1
    },
    {
      id: uid(),
      name: 'Thane Ironbraid',
      icon: '',
      imageUrl: '',
      player: 'Player',
      class: 'Paladin',
      subclass: 'Oath of the Crown',
      level: 8,
      race: 'Mountain Dwarf',
      background: 'Noble',
      alignment: 'Lawful Good',
      str: 17, dex: 10, con: 16, int: 12, wis: 14, cha: 15,
      passive: 12,
      maxHp: 84, currentHp: 84, tempHp: 0,
      ac: 20, initiative: 0, speed: 25,
      hitDice: 'd10',
      saves: { str: false, dex: false, con: false, int: false, wis: true, cha: true },
      skills: { athletics: true, insight: true, persuasion: true, religion: true },
      attacks: 'Battleaxe: +6 to hit, 1d8+3 slashing (versatile 1d10+3)\nWarhammer: +6 to hit, 1d8+3 bludgeoning\nDivine Smite: +2d8 radiant on hit',
      equipment: 'Battleaxe, Warhammer, Plate Armor, Shield, Holy Symbol of Moradin, Signet Ring, Fine Clothes, Scroll of Pedigree, Pipe and tobacco',
      traits: 'My eloquent flattery makes everyone I talk to feel important. I take great pains to always look my best.',
      ideals: 'Responsibility. It is my duty to respect the authority of those above me, just as those below me must respect mine.',
      bonds: 'The Ironbraid clan has defended the mountain halls for a thousand years. I will not be the last.',
      flaws: 'I secretly believe that everyone is beneath me. I hide a truly scandalous secret that could ruin my family forever.',
      features: 'Divine Sense, Lay on Hands (40), Fighting Style: Defense, Divine Smite, Divine Health, Oath Spells, Channel Divinity: Champion Challenge / Turn the Tide, Extra Attack, Aura of Protection (+2)',
      backstory: 'Thane Ironbraid is the last heir to the Ironbraid clan, whose mountain halls fell to a dracolich three decades ago. He has spent his life in exile among human courts, earning respect through valor and diplomacy. His oath to reclaim Ironhold drives him forward, but privately he mourns a kingdom he barely remembers. He carries his father\'s pipe, still packed with the same tobacco blend, which he smokes when reflecting on what was lost. He met Goorlel during the siege and has been his stalwart companion ever since.',
      notes: 'Always smokes his father\'s pipe before battle. The smoke sometimes forms shapes of dwarven runes - nobody knows if it\'s magic or habit.',
      proficiencies: 'All armor, shields, simple weapons, martial weapons, Smith\'s tools, one type of gaming set',
      conditions: [],
      createdAt: Date.now() + 2,
      updatedAt: Date.now() + 2
    }
  ];

  // ── SESSION ──────────────────────────────────────────────────
  const session = {
    id: uid(),
    number: 1,
    title: 'The Eye Beneath the Mountain',
    date: new Date().toISOString().slice(0, 10),
    type: 'combat',
    summary: 'The party descended into the Weeping Labyrinth beneath Mount Kargath, following rumors that the beholder Xanathrax had made its lair in the ancient dwarven cisterns. Battle Boy\'s flute echoed through the tunnels, drawing out goblin scouts that Goorlel dispatched with brutal efficiency. But deeper in the dark, a single green eye opened — and the real fight began.',
    notes: 'KEY MOMENTS:\n\n1. Battle Boy used Shatter to collapse a tunnel, cutting off goblin reinforcements. Goorlel was NOT happy about the structural damage to dwarven stonework.\n\n2. Thane Ironbraid challenged Xanathrax with Champion Challenge, forcing the beholder to focus its eye rays on him while the others flanked.\n\n3. Kapitein Goorlel threw his warhammer at the beholder from across the chamber — natural 20. The hammer struck the central eye, and for a moment, Goorlel saw his own reflection in it: older, scarred, but unbroken.\n\n4. Battle Boy played a dirge on his bone flute as the beholder fell. Even the goblins stopped fighting to listen. Then he ruined the moment by yelling "BATTLE BOY!" at the top of his lungs.\n\nLOOT:\n- Beholder Eye Crystal (Goorlel claimed it)\n- Staff of the Eye (Thane took for study)\n- 2,400 gold pieces\n- Scroll of Disintegrate\n- Potion of Greater Healing x3',
    party: [],
    xpAwarded: 3600,
    gpAwarded: 2400,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  // Link party
  session.party = campaignChars.map(c => c.id);

  // Add to existing data
  characters.push(...campaignChars);
  sessions.push(session);

  // Save all
  Promise.all([
    ...campaignChars.map(c => DB.save('characters', c, characters)),
    DB.save('sessions', session, sessions)
  ]).then(() => {
    renderCharList();
    updateStatus();
    alert('Campaign imported!\n\n' + campaignChars.length + ' characters and 1 session added:\n\n' +
      campaignChars.map(c => '- ' + c.name + ' (Lv' + c.level + ' ' + c.race + ' ' + c.class + ')').join('\n') +
      '\n\nSession: "' + session.title + '"');
  });
}
