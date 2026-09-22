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

export function buildPitchLabSampleIdeas(input: SampleInput): { title: string; ideaText: string }[] {
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
