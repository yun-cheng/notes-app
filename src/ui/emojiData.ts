/**
 * The emoji the reaction picker lists, by group, each with words to find it by. Not every emoji there is: any other
 * can be typed or pasted into the picker's search, from the system's emoji keyboard.
 */
export interface EmojiGroup {
  name: string;
  emoji: { char: string; words: string }[];
}

// Each line is an emoji, then the words it's found by.
const RAW: [string, string][] = [
  [
    'Smileys',
    `😀 grinning smile happy
😃 smiley happy joy
😄 smile happy laugh
😁 grin beaming
😆 laughing satisfied
😅 sweat smile relief
🤣 rofl rolling laughing
😂 joy tears laughing lol
🙂 slight smile
🙃 upside down silly
😉 wink
😊 blush smiling
😇 innocent halo angel
🥰 smiling hearts love
😍 heart eyes love
🤩 star struck amazing
😘 kiss blow
😋 yum delicious
😛 tongue
😜 wink tongue crazy
🤪 zany crazy
🤑 money
🤗 hug hugging
🤭 hand over mouth oops
🤫 shush quiet secret
🤔 thinking hmm
🫡 salute
🤐 zipper mouth secret
🤨 raised eyebrow skeptical
😐 neutral meh
😑 expressionless
😶 no mouth speechless
🙄 eye roll
😏 smirk
😬 grimace awkward
😌 relieved calm
😔 pensive sad
😪 sleepy
😴 sleeping tired zzz
😷 mask sick
🤒 thermometer sick ill
🤢 nauseated sick
🤯 mind blown exploding head
🥳 party celebrate birthday
🥺 pleading puppy eyes
😎 cool sunglasses
🤓 nerd glasses
🧐 monocle curious
😕 confused
😟 worried
😮 open mouth wow surprised
😲 astonished shocked
😳 flushed embarrassed
🥹 holding back tears grateful
😦 frowning
😨 fearful scared
😰 anxious sweat
😥 sad relieved
😢 cry sad tear
😭 sob crying
😱 scream fear
😖 confounded
😣 persevere
😞 disappointed
😓 downcast sweat
😩 weary
😫 tired
🥱 yawn bored
😤 triumph huff
😡 angry rage pout
😠 angry mad
🤬 cursing swearing
😈 smiling devil
💀 skull dead
💩 poop
🤡 clown
👻 ghost
👽 alien
🤖 robot`,
  ],
  [
    'Gestures',
    `👍 thumbs up yes like approve +1
👎 thumbs down no dislike -1
👌 ok perfect
🤌 pinched fingers
✌️ victory peace
🤞 fingers crossed luck hope
🤟 love you
🤘 rock on horns
🤙 call me shaka
👈 point left
👉 point right
👆 point up
👇 point down
☝️ index up one
👋 wave hello bye
🤚 raised back hand
✋ raised hand stop high five
🖖 vulcan
👏 clap applause bravo
🙌 raised hands hooray praise
🫶 heart hands
👐 open hands
🤲 palms up
🤝 handshake deal agree
🙏 pray please thanks folded hands
✍️ writing
💪 muscle strong flex
🧠 brain smart
👀 eyes look watching
👁️ eye
🫠 melting
🫣 peeking
🙈 see no evil monkey
🙉 hear no evil
🙊 speak no evil
🤷 shrug dunno
🤦 facepalm
🙋 raising hand me
🙇 bow
💃 dancer dance
🕺 dancing man`,
  ],
  [
    'Hearts',
    `❤️ red heart love
🧡 orange heart
💛 yellow heart
💚 green heart
💙 blue heart
💜 purple heart
🖤 black heart
🤍 white heart
🤎 brown heart
💔 broken heart
❣️ heart exclamation
💕 two hearts
💞 revolving hearts
💓 beating heart
💗 growing heart
💖 sparkling heart
💘 cupid arrow
💝 heart gift ribbon
❤️‍🔥 heart on fire
💯 hundred perfect score
💢 anger
💥 boom collision
💫 dizzy
💦 sweat drops
💨 dash fast
💬 speech bubble comment
💭 thought bubble
💤 zzz sleep`,
  ],
  [
    'Nature',
    `🐶 dog puppy
🐱 cat kitten
🐭 mouse
🐰 rabbit bunny
🦊 fox
🐻 bear
🐼 panda
🐨 koala
🐯 tiger
🦁 lion
🐮 cow
🐷 pig
🐸 frog
🐵 monkey
🐔 chicken
🐧 penguin
🐦 bird
🦉 owl
🦄 unicorn
🐝 bee
🦋 butterfly
🐢 turtle slow
🐍 snake
🐙 octopus
🐳 whale
🐬 dolphin
🐟 fish
🦀 crab
🌵 cactus
🎄 christmas tree
🌲 tree evergreen
🌳 tree
🌴 palm tree
🌱 seedling sprout grow
🌿 herb
🍀 four leaf clover luck
🍁 maple leaf autumn
🍂 fallen leaves fall
🌷 tulip flower
🌹 rose flower
🌻 sunflower
🌸 cherry blossom
💐 bouquet flowers
🌞 sun face
🌝 full moon face
🌙 crescent moon night
⭐ star
🌟 glowing star
✨ sparkles magic
⚡ lightning zap
🔥 fire hot lit
🌈 rainbow
☀️ sun sunny
⛅ cloudy
🌧️ rain
⛈️ storm thunder
❄️ snowflake cold
☃️ snowman winter
🌊 wave ocean
💧 droplet water`,
  ],
  [
    'Food',
    `🍎 apple
🍊 orange
🍋 lemon
🍌 banana
🍉 watermelon
🍇 grapes
🍓 strawberry
🫐 blueberries
🍑 peach
🥭 mango
🍍 pineapple
🥥 coconut
🥑 avocado
🍅 tomato
🥕 carrot
🌽 corn
🌶️ hot pepper spicy
🥦 broccoli
🍄 mushroom
🥐 croissant
🍞 bread
🧀 cheese
🥚 egg
🍳 cooking fried egg
🥞 pancakes
🥓 bacon
🍔 burger hamburger
🍟 fries
🍕 pizza
🌭 hot dog
🌮 taco
🌯 burrito
🥗 salad
🍝 spaghetti pasta
🍜 ramen noodles
🍣 sushi
🍱 bento
🥟 dumpling
🍦 ice cream
🍩 doughnut donut
🍪 cookie
🎂 birthday cake
🍰 cake shortcake
🧁 cupcake
🍫 chocolate
🍬 candy
🍿 popcorn
☕ coffee hot drink tea
🍵 tea matcha
🧋 bubble tea boba
🍺 beer
🍻 cheers beers
🥂 champagne toast celebrate
🍷 wine
🍸 cocktail
🥤 soda cup`,
  ],
  [
    'Activity',
    `🎉 party tada celebrate hooray
🎊 confetti
🎈 balloon
🎁 gift present
🎀 ribbon bow
🎂 cake birthday
🏆 trophy win champion
🥇 gold medal first
🥈 silver medal second
🥉 bronze medal third
🏅 medal sports
⚽ soccer football
🏀 basketball
🏈 american football
⚾ baseball
🎾 tennis
🏐 volleyball
🏓 ping pong
🏸 badminton
⛳ golf
🎯 bullseye target goal
🎳 bowling
🎮 video game controller
🎲 dice game
🧩 puzzle
♟️ chess
🎨 art palette paint
🎭 theater drama
🎬 movie film clapper
🎤 microphone sing karaoke
🎧 headphones music
🎵 music note
🎶 notes music
🎸 guitar
🎹 piano keyboard
🥁 drum
🏃 running run
🚴 cycling bike
🏊 swimming swim
🧘 yoga meditate
🏋️ weight lifting gym
⛷️ skiing
🏂 snowboard`,
  ],
  [
    'Travel',
    `🚗 car
🚕 taxi
🚌 bus
🚲 bicycle bike
🛵 scooter
🚂 train locomotive
🚆 train
✈️ airplane plane flight
🚀 rocket launch ship
🛸 ufo
🚢 ship boat
⛵ sailboat
⚓ anchor
🗺️ map world
🧭 compass
🏔️ mountain snow
⛰️ mountain
🏕️ camping
🏖️ beach umbrella
🏝️ island
🏠 house home
🏡 house garden
🏢 office building
🏫 school
🏥 hospital
🏰 castle
🗼 tower
🗽 statue of liberty
⛪ church
🕌 mosque
⛩️ shrine
🌍 globe earth world
🌃 night city
🌅 sunrise
🌄 sunrise mountains
🎡 ferris wheel
🎢 roller coaster
⛺ tent
🧳 luggage suitcase trip
🛫 departure takeoff
🛬 arrival landing`,
  ],
  [
    'Objects',
    `⌚ watch
📱 phone mobile
💻 laptop computer
⌨️ keyboard
🖥️ desktop computer
🖨️ printer
📷 camera photo
🎥 movie camera
📺 tv television
⏰ alarm clock
⏳ hourglass time waiting
💡 bulb idea
🔦 flashlight
🕯️ candle
💸 money flying
💰 money bag
💳 credit card
💎 gem diamond
🔧 wrench fix tool
🔨 hammer
🛠️ tools build
⚙️ gear settings
🔩 nut bolt
🧲 magnet
🧪 test tube experiment
🔬 microscope science
🔭 telescope
💊 pill medicine
🩺 stethoscope doctor
🧹 broom clean
🧺 basket
🛒 cart shopping
🔑 key
🗝️ old key
🔒 lock locked
🔓 unlocked
📦 package box shipping
📮 postbox mail
✉️ envelope email letter
📧 email
📝 memo note write
📌 pushpin pin
📎 paperclip attach
✂️ scissors cut
📏 ruler
📐 triangle ruler
📅 calendar date
📆 calendar tear off
🗓️ spiral calendar
📊 bar chart stats
📈 chart up growth
📉 chart down decline
📋 clipboard list
📁 folder
🗂️ dividers files
📚 books read library
📖 book open read
🔖 bookmark
🏷️ label tag
🔗 link
🧾 receipt
🎓 graduation cap
👓 glasses
👕 shirt
👗 dress
👟 sneaker shoe
👑 crown king queen`,
  ],
  [
    'Symbols',
    `✅ check done yes complete
☑️ check box
✔️ check mark
❌ cross no wrong cancel
❎ cross mark button
➕ plus add
➖ minus
❗ exclamation important
❓ question
‼️ double exclamation
⁉️ exclamation question
⚠️ warning caution
🚫 prohibited no forbidden
⛔ no entry stop
🛑 stop sign
🔴 red circle
🟠 orange circle
🟡 yellow circle
🟢 green circle
🔵 blue circle
🟣 purple circle
⚫ black circle
⚪ white circle
🟥 red square
🟩 green square
🟦 blue square
⬆️ up arrow
⬇️ down arrow
⬅️ left arrow
➡️ right arrow
🔄 repeat counterclockwise
🔁 repeat
🔀 shuffle
▶️ play
⏸️ pause
⏹️ stop
⏩ fast forward
🆗 ok button
🆕 new
🆒 cool
🆓 free
🔝 top
🔜 soon
💲 dollar
♻️ recycle
⭕ circle
✳️ asterisk
❇️ sparkle
©️ copyright
™️ trademark
#️⃣ hash number
🔢 numbers
🏁 checkered flag finish
🚩 red flag
🏳️ white flag
🏳️‍🌈 rainbow flag pride`,
  ],
];

export const EMOJI_GROUPS: EmojiGroup[] = RAW.map(([name, lines]) => ({
  name,
  emoji: lines.split('\n').map((line) => {
    const space = line.indexOf(' ');
    return { char: line.slice(0, space), words: line.slice(space + 1) };
  }),
}));

/** The emoji whose words start with each word of `query`, each once, in the order they're listed. */
export function searchEmoji(query: string): string[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const found = new Set<string>();
  for (const group of EMOJI_GROUPS) {
    for (const { char, words } of group.emoji) {
      const own = words.split(' ');
      if (terms.every((t) => own.some((w) => w.startsWith(t)))) found.add(char);
    }
  }
  return [...found];
}
