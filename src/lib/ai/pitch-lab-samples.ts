export const PITCH_LAB_SAMPLE_TITLE_PREFIX = "[Sample] ";

export function isPitchLabSampleMode(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.PITCH_LAB_USE_REAL_AI === "true") return false;
  if (process.env.PITCH_LAB_USE_SAMPLES === "false") return false;
  return true;
}

type SampleInput = {
  generationType: "framework" | "adaptation";
  adaptationStyle: "close" | "loose";
  sourceTitle: string;
  selectedPremise?: string;
};

export type PitchLabSamplePremise = {
  title: string;
  premiseText: string;
  appealLane: string;
  transformationNotes: string;
};

// Prompt/sample title constraints v1.1 (2026-09-18): every title is one or two words.
const FRAMEWORK_IDEAS = [
  ["Defusal", "A charming bomb technician is trapped in a stalled elevator with the building owner's daughter, who has a vest counting down beneath her coat. She keeps moving to hide how terrified she is, so he gets her to match his breathing by making up ridiculous stories about their future together. The doors finally open and the vest is safe. Then the elevator starts rising by itself, with someone inside on every floor."],
  ["Impostor", "A night-shift nurse sees a man shove a stranger onto the tracks, then realizes the stranger is her missing husband. The off-duty detective beside her insists the cameras show she did it, and they have one train ride to prove who is lying. When the doors open, her husband steps out alive and calls the detective by a name nobody should know."],
  ["Second Ring", "A wedding planner locks the runaway bride in a supply room so the ceremony can start. The groom's furious older brother helps the bride climb out, but she refuses to leave until she knows why he came back after ten years. They uncover a hidden letter in the wedding dress and learn the groom has been paying the brother to stay away. The bride walks to the altar anyway, carrying a second ring."],
  ["Room 17", "A broke motel clerk lets a stranger hide in room 17 while a storm traps the town. The sheriff arrives asking for the stranger by name, and the clerk lies because the man just saved a child from the flooded road. They spend the night building an escape plan and almost kiss. At dawn, the clerk opens the room safe and finds her own photograph inside."],
  ["False Promise", "A street magician steals an engagement ring from a woman who swears she never owned it. She corners him backstage and demands the secret message engraved inside, so he admits his brother planted it to frame her for a jewel heist. They fake an engagement to get into the family mansion. At the party, the groom is waiting with the real ring and a wedding license."],
  ["Evacuation", "A meticulous hotel auditor pulls a reckless fire captain out of a locked service stairwell moments before a real alarm sends the guests running. They have to lead the evacuation together while arguing about who caused the first alarm. When the last guest is safe, they discover one room was never on the hotel plan. Someone inside calls the auditor by her childhood nickname."],
  ["Missing Evidence", "A public defender gets stuck in a courthouse overnight with the judge who sent her brother to prison. He says he can prove the case was rigged, but only if she helps him find a missing evidence box before court opens. Their search turns into a confession about the night her brother disappeared. The evidence box is empty except for a fresh key to her apartment."],
  ["Cold Storage", "A food truck owner and a health inspector are locked inside a restaurant freezer after a midnight break-in. She thinks he is hiding the health violations that could close her business; he thinks she saw the thief's face. They thaw the emergency latch with a bottle of stolen champagne and admit what they were each really afraid of. Outside, her truck is gone and his badge is on the ground."],
  ["Buried Necklace", "A paramedic calls the emergency contact for an unconscious stranger and reaches the woman who left him at the altar. She arrives furious, then recognizes the necklace in his hand as one she buried with her sister. The paramedic and the ex race to find out how he got it, slowly realizing he may have saved the sister years ago. The patient wakes and asks which one of them is his wife."],
  ["Detonator", "A rookie negotiator is sent to talk down a bank robber who refuses to speak to police. Through the vault door, she learns he is trying to protect the cashier he claims kidnapped him. She gets him to trust her by admitting she once helped the same woman escape an abusive marriage. The robber walks out unarmed, but the cashier is still inside holding the detonator."],
  ["Phantom Cry", "A sleep-deprived nanny hears a baby crying through a monitor that belongs to the apartment next door. The baby's father insists there is no child there, yet he knows every lullaby she sings. They break into the empty unit and find a nursery, a hospital bracelet, and a note in her handwriting. The baby's cry suddenly comes from her own locked bedroom."],
  ["Empty Aquarium", "A broke rideshare driver picks up a millionaire who begs her to say he was with her when a museum guard vanished. She refuses until the guard's daughter appears in the back seat with a bloodied key. The three of them hide in a closed aquarium and uncover a family secret while the millionaire tries to buy his way out. The missing guard calls the driver and says her father is alive."],
  ["False Burial", "A florist brings a funeral wreath to the wrong house and finds the supposed dead man very much alive, handcuffed to a radiator. The cop guarding him claims he is a killer, but the florist recognizes the song he uses to calm her little brother. She cuts the chain and helps him escape through the flower market. At sunrise, the dead man's portrait is on every news channel, and the cop is named as the victim."],
  ["Open Line", "A radio host takes one final call before her station shuts down and hears her ex confess to a murder live on air. He says the victim is still alive and gives her clues only she would understand. She races across town with the station's grumpy engineer, who keeps cutting the broadcast to protect her. The signal goes dead just as the caller says her real name."],
  ["Double Booked", "Two strangers arrive for the same remote cabin: a wedding singer escaping a groom and a private investigator tracking the groom's missing fiancÃ©e. They agree to share the cabin until the road clears, each hiding why they need to stay. A storm knocks out the power and reveals they have been following the same woman for very different reasons. Her car pulls into the driveway, empty and still running."],
  ["Blackout", "A pharmacy owner refuses to give a desperate police officer the medicine he needs for a woman locked in his trunk. She makes him tell the whole truth while the town's blackout traps them inside. Their argument turns into a plan to save the woman without calling backup, and the officer gives her his badge as proof he will stay. The medicine label carries the pharmacist's own name."],
  ["Second Bride", "A videographer notices the bride whispering for help in the wedding footage and corners the groom's best friend before the reception. He admits the bride asked him to ruin the ceremony, but refuses to say why. They replay the footage frame by frame and uncover a second bride hiding in the venue. The woman in white is not the bride they invited."],
  ["Disappearing Ink", "A border officer recognizes the smuggler in her queue as the boy who saved her life as a child. He says he is carrying no contraband, only a message that could stop her father's arrest. She risks her career to search his bags in private and finds them empty. The message is written under her skin in disappearing ink."],
  ["Hidden Room", "A landlord shows a new tenant the apartment where his sister vanished, then insists the spare room has never existed. The tenant hears someone knocking from behind a bricked-up wall and persuades him to open it. They find a phone still ringing with a live call from the missing sister. The voice on the line says the landlord is the one who let her out."],
  ["Death Ticket", "A ferry captain discovers a passenger hiding below deck with the same name as the woman listed as drowned five years ago. A marine investigator boards to arrest him, but the captain knows the investigator has been falsifying the passenger log. They work together to reach shore before the ferry turns back. In the cabin, a second ticket has the captain's name and tomorrow's date of death."],
] as const;

const ADAPTATION_TITLES = ["Floodgate", "Runaway", "Last Route", "Blackout", "Open Frequency", "False Portrait", "Sealed Verdict", "Dead Reckoning", "Rising Water", "Living Funeral", "Missing Passport", "Power Cut", "After Hours", "Stolen Ignition", "Hidden Floor", "Eye of Storm", "Second Vow", "Empty Rides", "Fireline", "Final Fare"] as const;

const ADAPTATION_VARIANTS = [
  ["ER nurse", "fire investigator", "a shuttered seaside hotel"],
  ["wedding planner", "divorce lawyer", "an empty wedding venue"],
  ["night bus driver", "missing-person detective", "the last route through downtown"],
  ["small-town pharmacist", "undercover officer", "a locked pharmacy during a blackout"],
  ["radio host", "sound engineer", "a station during its final broadcast"],
  ["museum curator", "security guard", "a gallery during a midnight gala"],
  ["courthouse clerk", "public defender", "a courthouse sealed overnight"],
  ["ferry captain", "marine investigator", "a crossing in heavy fog"],
  ["motel manager", "stranded paramedic", "a roadside motel cut off by flooding"],
  ["flower-shop owner", "funeral director", "a funeral home before dawn"],
  ["airport cleaner", "customs officer", "a terminal during a security lockdown"],
  ["private chef", "family chauffeur", "a mansion during a power outage"],
  ["school counselor", "new substitute teacher", "a school after the last bell"],
  ["night-shift mechanic", "stolen-car investigator", "an isolated service station"],
  ["apartment superintendent", "new tenant", "a tower with one working elevator"],
  ["storm chaser", "local weather reporter", "a town shelter as the storm arrives"],
  ["wedding singer", "groom's older brother", "a reception hall during the ceremony"],
  ["ride-share driver", "bail bonds agent", "a closed amusement park"],
  ["hotel auditor", "fire captain", "a high-rise hotel during evacuation"],
  ["late-night diner owner", "off-duty detective", "a diner beside an empty highway"],
] as const;

const FRAMEWORK_PREMISES: PitchLabSamplePremise[] = [
  { title: "Debt Bride", premiseText: "A street-smart debt collector crashes a luxury engagement dinner to seize a fake bride's necklace, only to learn the groom's quiet brother needs her lie to stop a family takeover.", appealLane: "forced alliance", transformationNotes: "Status collision with a family-power trap." },
  { title: "Fireline", premiseText: "A hotel safety auditor trying to save her job exposes a fake evacuation drill, then has to trust the reckless fire captain who may have staged it to flush out a saboteur.", appealLane: "competence collision", transformationNotes: "Workplace pressure becomes a dangerous partnership." },
  { title: "Wrong Verdict", premiseText: "Mira, a courthouse clerk, swaps one file to protect her sister, but Jae, the defendant's icy lawyer, catches her and quietly uses the mistake to drag them both into a live hearing.", appealLane: "legal trap", transformationNotes: "Immediate procedural pressure with visible stakes." },
  { title: "Last Route", premiseText: "Ara, a night bus driver, refuses a cash bribe from Minjun, a rich passenger, then discovers his ticket route matches the missing-person alert playing on every screen.", appealLane: "public danger", transformationNotes: "Moving-location mystery with forced proximity." },
  { title: "Storm Key", premiseText: "A motel manager shelters a soaked stranger during a flood, then finds the emergency key he carries opens the room where her father vanished years ago.", appealLane: "rescue reversal", transformationNotes: "Intimate storm setting with personal stakes." },
  { title: "False Guest", premiseText: "A wedding singer hides from an angry groom inside the wrong private suite, where the groom's brother mistakes her for the blackmailer he secretly came to pay.", appealLane: "mistaken identity", transformationNotes: "Wrong-person collision inside a public ceremony." },
  { title: "Open Mic", premiseText: "A radio host taking her final live call hears a powerful club owner confess to a crime, then realizes he is standing outside the studio door listening to her broadcast.", appealLane: "voice trap", transformationNotes: "Audio hook with immediate physical threat." },
  { title: "Cold Room", premiseText: "A food truck owner locked in a restaurant freezer with a health inspector must keep him conscious long enough to prove the break-in was aimed at her recipe book.", appealLane: "survival banter", transformationNotes: "Physical crisis tied to ambition and suspicion." },
  { title: "Second Ticket", premiseText: "A ferry captain catches a marine investigator hiding below deck, and both discover the death ticket in his pocket is printed with her name and tomorrow's date.", appealLane: "fate pressure", transformationNotes: "Mystery pressure on a contained route." },
  { title: "Missing Badge", premiseText: "A pharmacy owner refuses medicine to a bleeding officer until he admits the woman in his trunk is alive, wanted, and carrying the pharmacist's own stolen badge.", appealLane: "moral pressure", transformationNotes: "Authority conflict with a visible dilemma." },
  { title: "Hidden Wall", premiseText: "A new tenant hears knocking behind a sealed apartment wall, but the landlord who can open it is the man her missing sister once warned her never to trust.", appealLane: "domestic danger", transformationNotes: "Contained space with personal history." },
  { title: "Double Bride", premiseText: "A wedding videographer spots a second bride in the live feed and forces the groom's best friend to help her find which woman the family is trying to erase.", appealLane: "public scandal", transformationNotes: "Visual proof drives the hook and trap." },
];

const ADAPTATION_PREMISES: PitchLabSamplePremise[] = [
  { title: "Cold Room", premiseText: "A pastry-shop owner keeps a powerful investor calm during a freezer lock-in, then learns he has bought her failed audition debt to force one more performance.", appealLane: "competence under pressure", transformationNotes: "Preserves crisis-born attachment while changing job, setting, and obligation." },
  { title: "Fire Audit", premiseText: "A hotel auditor saves a wounded guest during a false alarm, then discovers he is the fire captain investigating the evacuation report that could end her career.", appealLane: "dangerous gratitude", transformationNotes: "Transforms caregiver surface into workplace competence and institutional pressure." },
  { title: "Last Table", premiseText: "A diner owner talks a bleeding stranger through shock during a blackout, then finds his men have booked every table until she agrees to hide him from police.", appealLane: "forced protection", transformationNotes: "Keeps nerve-plus-charm survival but changes the follow-up trap." },
  { title: "Open Stage", premiseText: "A community-theater stage manager saves a patron from a rigging accident, then sees her name printed as lead performer by the donor whose secret she witnessed.", appealLane: "public coercion", transformationNotes: "Replaces private care with public performance pressure." },
  { title: "Storm Escort", premiseText: "A ferry medic calms a dangerous passenger during a collision scare, then must escort him ashore because his enemies think she received his missing evidence.", appealLane: "accidental alliance", transformationNotes: "Changes occupation stakes and cliffhanger mechanism." },
  { title: "False Note", premiseText: "A piano tuner saves a club owner from choking during a gala, then finds a signed contract claiming she agreed to authenticate the instrument hiding his ledger.", appealLane: "skill trap", transformationNotes: "Keeps performance-world charge without repeating nurse or caregiver logic." },
  { title: "Back Room", premiseText: "A casino cashier talks a stabbed VIP through panic behind the counting room, then security frames her as the thief who stole the chip he was protecting.", appealLane: "status reversal", transformationNotes: "Preserves dangerous male pressure but makes heroine the accused actor." },
  { title: "Locked Lens", premiseText: "A wedding photographer steadies a collapsing heir during a ceremony stampede, then his family demands the memory card because it captured who caused it.", appealLane: "evidence trap", transformationNotes: "Transforms medical rescue into visual evidence pressure." },
  { title: "Night Shift", premiseText: "A tow-truck driver saves a bleeding businessman after a road attack, then his company impounds her truck as leverage until she recreates his final route.", appealLane: "working-class leverage", transformationNotes: "Keeps indebted powerful man, changes world and obligation." },
  { title: "Quiet Room", premiseText: "A library clerk helps a panicked patron hide from armed men, then learns he has named her as the only witness in a corporate kidnapping report.", appealLane: "soft-space danger", transformationNotes: "Moves the competence engine into a non-medical quiet setting." },
  { title: "Gold Card", premiseText: "A pawnshop appraiser keeps a wounded heir talking while valuing his bloodied watch, then his family claims she accepted payment to become his alibi.", appealLane: "transaction trap", transformationNotes: "Transforms care contract into alibi and money pressure." },
  { title: "Exit Row", premiseText: "An airport cleaner saves a first-class passenger during a security lockdown, then his assistant prints her name on the manifest as his personal escort.", appealLane: "public status collision", transformationNotes: "Keeps forced proximity but changes the crisis and visible institution." },
];

export function buildPitchLabSamplePremises(input: SampleInput): PitchLabSamplePremise[] {
  return input.generationType === "framework" ? FRAMEWORK_PREMISES : ADAPTATION_PREMISES;
}

export function buildPitchLabSampleIdeas(input: SampleInput): { title: string; ideaText: string }[] {
  if (input.selectedPremise) {
    const premise = input.selectedPremise.replace(/\s+/g, " ").trim();
    const lowerPremise = premise.toLocaleLowerCase();
    if (lowerPremise.includes("courthouse clerk")) {
      return [
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Live File`, ideaText: "Mira, a courthouse clerk who has spent years covering for her reckless sister, slips a sealed plea file into the wrong case folder minutes before a televised corruption hearing. Jae, the defendant's lawyer, catches the swap before security does, but he does not expose her because the file proves his client is being framed by the same judge who can ruin Mira's family. He forces Mira to sit beside him as his emergency assistant so he can use her access badge inside the courtroom. Every question he asks makes her look more guilty, and every answer pulls her sister closer to the case. When the judge orders the clerk who handled the file to step forward, Jae passes Mira a note: confess to the swap, or your sister takes the stand." },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Witness Seat`, ideaText: "Mira swaps one page in a plea agreement to keep her sister out of prison, then turns around to find Jae, the defendant's lawyer, watching from the records-room doorway. He should report her immediately, but the forged page carries a signature he has been trying to prove is fake for months. Jae pulls Mira into the hearing as a records witness, using her mistake to delay the plea before the judge can seal it. Mira tries to stay quiet, but the prosecutor notices her shaking hands and asks who ordered the file change. Jae cuts in with a question that saves her and traps her: why did the court's own system log the swap under her sister's name two hours before Mira touched the file?" },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Court Lock`, ideaText: "After Mira swaps a case file to protect her sister, a courthouse lockdown traps her in the evidence wing with Jae, the defense lawyer who caught her. He refuses to let her erase the security footage because the clip also shows his client being threatened by a bailiff. They race through empty corridors, trading accusations while alarms announce that all courtroom doors will seal in ten minutes. Mira thinks Jae is using her as a scapegoat until he admits the bailiff killed his last witness. She helps him reach the live hearing feed, but the screen turns on before they are ready, broadcasting Mira with the stolen file in her hand." },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Plea Trap`, ideaText: "Mira changes a plea file to save her sister, only for Jae, the defendant's cold lawyer, to catch the exact moment on his phone. Instead of blackmailing her for money, he demands she walk into Courtroom 3 and deliver the altered file herself. Mira realizes he needs the judge to accept the wrong document on record so he can expose a larger fraud, but the plan makes her the visible criminal. She tries to run when her sister appears in the gallery, already escorted by police. Jae blocks the aisle and quietly tells Mira that if she leaves now, the original file will convict both sisters by noon." },
      ];
    }
    if (lowerPremise.includes("night bus driver")) {
      return [
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Last Stop`, ideaText: "Ara, a night bus driver, refuses Minjun's cash bribe when he begs her to skip the last downtown stop. The route screens flicker with a missing-person alert, and the number printed on Minjun's ticket matches the route the missing girl took before vanishing. Ara locks the doors and keeps driving because the bus camera is still live, but Minjun claims the alert is a trap meant to draw out the real abductor sitting among the passengers. Ara tests him by announcing a fake detour, and one silent rider immediately reaches for a hidden phone. At the terminal, police surround the bus, but the missing girl's voice comes over Ara's radio from inside the locked luggage hold." },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Route Nine`, ideaText: "Ara is finishing her final night shift when Minjun, a rich passenger with blood on his cuff, offers enough money to buy the bus if she changes the route. She refuses until every ad screen on board switches to a missing-person alert with Minjun's ticket number stamped across it. He says the missing woman is his sister and the ticket is proof someone is copying his movements. Ara keeps the bus on schedule while quietly using the mirror to watch the other passengers. When she pulls into Route Nine's abandoned stop, Minjun steps off to surrender, but the bus doors close behind him and Ara's own name appears as the next alert." },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Night Fare`, ideaText: "Ara starts Route Nine with only three passengers left when Minjun drops a stack of cash into her fare tray and asks her to drive past the police checkpoint. She refuses, points to the onboard camera, and tells him every coin and bill is recorded. Then the checkpoint alert changes: police are searching for a missing woman last seen boarding Ara's bus with Minjun's ticket number. Minjun claims the woman is alive and will die if the bus stops where the alert demands. Ara keeps the doors locked and makes every passenger move into camera view. One woman panics and tries to break the emergency glass. Ara grabs the brake, Minjun catches the woman before she falls, and the woman's phone rings with Ara's route announcement playing from inside a closed suitcase." },
        { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Terminal Light`, ideaText: "Ara, a night bus driver on probation after one passenger complaint, refuses Minjun's offer to buy the whole route when he begs her to turn off the terminal lights. His ticket number flashes across the missing-person alert on every screen, so Ara keeps him in the front seat where the camera can see both hands. Minjun says the alert is bait and the missing woman sent him to find the driver who ignored her last call. Ara does not believe him until her dispatch radio repeats a message she deleted yesterday. She turns toward the old terminal to prove him wrong, but every streetlight along the route shuts off in sequence, leaving only the bus headlights and a child's bracelet swinging from the mirror." },
      ];
    }
    return [
      { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Pressure`, ideaText: `${premise} The heroine's risky move is already visible in the first shot, and the male lead catches enough of it to either expose her or use the mistake. He chooses to stay close because her action opens access to proof he cannot reach alone. She cooperates only because his plan protects the person she was trying to save. Their first win creates a louder public problem, and the episode ends with both of them accused of the same lie.` },
      { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Witness`, ideaText: `${premise} The episode keeps the heroine's job and motive clear, then turns the male lead into the only person who understands the real danger in her mistake. He blocks her escape, not because he trusts her, but because the wrong person is watching them both. Their argument becomes a cover story in front of witnesses. The final beat reveals that the trap was prepared before either of them entered the room.` },
      { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Proof`, ideaText: `${premise} The heroine tries to undo her choice in public, but the male lead forces her to finish it because stopping now would expose a more dangerous secret. She thinks he is sacrificing her until he quietly gives her the one detail that lets her survive the next question. The middle turn makes their private bargain visible to the crowd. The episode ends when the proof they needed appears under her name.` },
      { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}Lock`, ideaText: `${premise} A lockdown, broadcast, or formal deadline traps the heroine with the male lead before she can explain why she acted. He tests her story by making her repeat the risky move under pressure. She proves she is not helpless, but the test also confirms someone else planned the collision. They almost escape blame together, until the final announcement names the heroine as the person who started everything.` },
    ];
  }

  if (input.generationType === "framework") {
    return FRAMEWORK_IDEAS.map(([title, ideaText]) => ({
      title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}${title}`,
      ideaText,
    }));
  }

  return ADAPTATION_VARIANTS.map(([lead, counterpart, setting], index) => {
    const title = ADAPTATION_TITLES[index];

    const ideaText = input.adaptationStyle === "close"
      ? `Sample placeholder based on â€œ${input.sourceTitle}.â€ Keep the source's major story beats, relationship turns, reveal, and ending in the same order. Recast the heroine as a ${lead} and the male lead as a ${counterpart}, and move the action to ${setting}; let their new jobs change how they handle each crisis. The source's final reversal lands almost beat for beat, then a new detail in the closing moment pulls the audience into episode two.`
      : `Sample placeholder inspired by â€œ${input.sourceTitle}.â€ Keep its central emotional engine, but rebuild the episode around a ${lead} and a ${counterpart} trapped in ${setting}. Their opposing goals force them to cooperate, a discovery changes what they believe about the source conflict, and the final beat reveals that one of them has been hiding a connection to the other.`;
    return { title: `${PITCH_LAB_SAMPLE_TITLE_PREFIX}${title}`, ideaText };
  });
}
