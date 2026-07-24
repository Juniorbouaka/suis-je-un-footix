/**
 * LA BANQUE ACTIVE — 400 footballeurs connus du grand public.
 *
 * Règles appliquées automatiquement au chargement (voir src/words.js) :
 * un seul mot, sans accent, sans tiret ni espace, 3 à 20 lettres.
 * Toute entrée non conforme est rejetée et signalée par « npm run check:bank ».
 *
 * niveau 1 : stars mondiales, connues même des non-passionnés
 * niveau 2 : joueurs connus de tout amateur de football
 *
 * Les fichiers players-*.js et legends.js contiennent une base élargie
 * (1551 noms, jusqu'aux profils pointus) : ils ne sont plus chargés, mais
 * restent disponibles si tu veux élargir plus tard.
 */
export const playersFamous = {
  category: 'joueur',
  tiers: {
    1: [
      'abidal', 'abraham', 'adebayor', 'adriano', 'afellay', 'aguero', 'alaba', 'alba',
      'albertini', 'alisson', 'alonso', 'alves', 'anelka', 'aranguiz', 'arbeloa', 'asensio',
      'aubameyang', 'azpilicueta', 'baggio', 'bale', 'ballack', 'barcola', 'beckenbauer', 'beckham',
      'bellarabi', 'bellerin', 'bellingham', 'benarfa', 'bender', 'bentancur', 'benzema', 'berbatov',
      'bergkamp', 'boateng', 'buffon', 'cafu', 'callejon', 'campbell', 'canizares', 'cantona',
      'carragher', 'carrasco', 'casemiro', 'casillas', 'cassano', 'cavani', 'cech', 'cocu',
      'coentrao', 'cole', 'coloccini', 'coman', 'conceicao', 'costa', 'costacurta', 'courtois',
      'coutinho', 'cruyff', 'cucurella', 'dembele', 'denilson', 'deschamps', 'donadoni', 'donnarumma',
      'drogba', 'duff', 'dybala', 'edmundo', 'emerson', 'essien', 'eto', 'eusebio',
      'evra', 'falcao', 'felix', 'fernandinho', 'figo', 'firmino', 'foden', 'forlan',
      'forsberg', 'fowler', 'gameiro', 'gerrard', 'giggs', 'gilardino', 'giovinco', 'giroud',
      'godin', 'grafite', 'griezmann', 'guardiola', 'gundogan', 'guti', 'haaland', 'hakimi',
      'hart', 'havertz', 'hazard', 'heinze', 'helguera', 'henderson', 'henry', 'hierro',
      'higuain', 'hummels', 'ibrahimovic', 'iniesta', 'isco', 'jesus', 'juan', 'kaka',
      'kane', 'kante', 'kean', 'keane', 'keita', 'khedira', 'kluivert', 'koke',
      'kompany', 'kovacic', 'kroos', 'lacazette', 'lampard', 'laporte', 'lautaro', 'lehmann',
      'lemar', 'lewandowski', 'ljungberg', 'lloris', 'lopez', 'luisao', 'lukaku', 'makaay',
      'makelele', 'maldini', 'mancini', 'mandzukic', 'mane', 'maradona', 'marcelo', 'marquinhos',
      'martinez', 'mascherano', 'mata', 'mcmanaman', 'mendieta', 'messi', 'mijatovic', 'milito',
      'modric', 'montella', 'morientes', 'muller', 'nasri', 'navas', 'neuer', 'neville',
      'neymar', 'numan', 'nunez', 'oblak', 'olmo', 'oscar', 'osimhen', 'otamendi',
      'owen', 'ozil', 'palacio', 'palermo', 'panucci', 'pauleta', 'payet', 'pedro',
      'pele', 'pepe', 'peruzzi', 'pickford', 'pires', 'pirlo', 'platini', 'pogba',
      'poulsen', 'puskas', 'quagliarella', 'rafinha', 'rakitic', 'ramsey', 'raul', 'ravanelli',
      'redondo', 'reiziger', 'reus', 'ribery', 'richarlison', 'riquelme', 'rivaldo', 'robben',
      'roberto', 'robinho', 'rodri', 'romario', 'ronaldinho', 'ronaldo', 'rooney', 'rudiger',
      'sabitzer', 'saka', 'salah', 'salgado', 'sanchez', 'sancho', 'sane', 'saul',
      'saviola', 'schmeichel', 'scholes', 'sheringham', 'signori', 'silva', 'solari', 'solskjaer',
      'stam', 'sterling', 'sturridge', 'suarez', 'tevez', 'thiago', 'toldo', 'tonali',
      'torres', 'totti', 'toure', 'turan', 'upamecano', 'valverde', 'varane', 'verratti',
      'vialli', 'vidal', 'vieira', 'vinicius', 'vitinha', 'volland', 'walcott', 'wendell',
      'werner', 'willian', 'xavi', 'yorke', 'zabaleta', 'zenden', 'zico', 'zidane',
    ],
    2: [
      'akanji', 'alvarez', 'araujo', 'balerdi', 'banks', 'barella', 'baresi', 'barthez',
      'bastoni', 'batistuta', 'bebeto', 'blanc', 'bowen', 'brandt', 'busquets', 'caicedo',
      'calhanoglu', 'camavinga', 'cannavaro', 'caqueret', 'carvajal', 'charlton', 'cherki', 'chiesa',
      'crespo', 'dalglish', 'davies', 'depay', 'desailly', 'doku', 'dunga', 'ederson',
      'fabregas', 'ferdinand', 'fernandes', 'gabriel', 'gakpo', 'garnacho', 'garrincha', 'gattuso',
      'gavi', 'gnabry', 'goretzka', 'grealish', 'greenwood', 'guimaraes', 'gullit', 'hagi',
      'harit', 'hojlund', 'immobile', 'inzaghi', 'isak', 'jackson', 'jota', 'kahn',
      'keegan', 'kempes', 'kimmich', 'kimpembe', 'klinsmann', 'klose', 'konate', 'kounde',
      'kvaratskhelia', 'lahm', 'leao', 'lineker', 'locatelli', 'lopes', 'maddison', 'maignan',
      'martinelli', 'matthaus', 'militao', 'mitoma', 'moore', 'mount', 'musiala', 'nedved',
      'nesta', 'nkunku', 'odegaard', 'onana', 'oyarzabal', 'palmer', 'papin', 'paqueta',
      'pedri', 'pellegrini', 'pique', 'pulisic', 'puyol', 'ramos', 'raphinha', 'rashford',
      'rice', 'rijkaard', 'robertson', 'rodrygo', 'romero', 'rongier', 'ruiz', 'rulli',
      'safonov', 'saliba', 'schweinsteiger', 'seedorf', 'shaw', 'shearer', 'shevchenko', 'shilton',
      'simeone', 'simons', 'sneijder', 'socrates', 'sommer', 'son', 'stoichkov', 'stones',
      'suker', 'szczesny', 'szoboszlai', 'tagliafico', 'tchouameni', 'terry', 'thuram', 'tolisso',
      'tomori', 'toney', 'trezeguet', 'trippier', 'veron', 'vidic', 'villa', 'vlahovic',
      'walker', 'watkins', 'wirtz', 'xhaka', 'yamal', 'yashin', 'zanetti', 'zinchenko',
    ],
  },
};
