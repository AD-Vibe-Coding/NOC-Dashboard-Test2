import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  ActionIcon,
  Alert,
  Autocomplete,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Progress,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowsExchange,
  IconClock,
  IconHistory,
  IconMapPin,
  IconWorldPin,
} from "@tabler/icons-react";
import { WidgetFrame } from "../WidgetFrame";

// ─── US State abbreviation ↔ full name ────────────────────────────────────────
const STATE_ABBR: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",
  HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",
  KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",
  MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",
  NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",
  NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",
  OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",
  SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",
  VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",
  DC:"District of Columbia",
};
const STATE_NAME_TO_ABBR: Record<string,string> = Object.fromEntries(
  Object.entries(STATE_ABBR).map(([k,v])=>[v.toLowerCase(),k])
);

// ─── Multi-timezone states ────────────────────────────────────────────────────
const MULTI_TZ_STATES: Record<string,string[]> = {
  FL:["America/New_York (most of FL)","America/Chicago (Panhandle west of Apalachicola)"],
  TX:["America/Chicago (most of TX)","America/Denver (El Paso / Hudspeth county)"],
  TN:["America/Chicago (western TN)","America/New_York (eastern TN)"],
  KY:["America/New_York (eastern KY)","America/Chicago (western KY)"],
  IN:["America/Indiana/Indianapolis (most of IN)","America/Chicago (NW/SW corners)"],
  ID:["America/Denver (southern ID)","America/Los_Angeles (northern panhandle)"],
  KS:["America/Chicago (most of KS)","America/Denver (western edge)"],
  NE:["America/Chicago (eastern NE)","America/Denver (western NE)"],
  ND:["America/Chicago (eastern ND)","America/Denver (western ND)"],
  SD:["America/Chicago (eastern SD)","America/Denver (western SD)"],
  OR:["America/Los_Angeles (western OR)","America/Boise (eastern OR)"],
  MI:["America/Detroit (lower peninsula)","America/Chicago (4 western UP counties)"],
};

// ─── Single-timezone states ───────────────────────────────────────────────────
const STATE_TZ: Record<string,string> = {
  AL:"America/Chicago",AK:"America/Anchorage",AZ:"America/Phoenix",
  AR:"America/Chicago",CA:"America/Los_Angeles",CO:"America/Denver",
  CT:"America/New_York",DE:"America/New_York",GA:"America/New_York",
  HI:"Pacific/Honolulu",IL:"America/Chicago",IA:"America/Chicago",
  LA:"America/Chicago",ME:"America/New_York",MD:"America/New_York",
  MA:"America/New_York",MN:"America/Chicago",MS:"America/Chicago",
  MO:"America/Chicago",MT:"America/Denver",NV:"America/Los_Angeles",
  NH:"America/New_York",NJ:"America/New_York",NM:"America/Denver",
  NY:"America/New_York",NC:"America/New_York",OH:"America/New_York",
  OK:"America/Chicago",PA:"America/New_York",RI:"America/New_York",
  SC:"America/New_York",UT:"America/Denver",VT:"America/New_York",
  VA:"America/New_York",WA:"America/Los_Angeles",WV:"America/New_York",
  WI:"America/Chicago",WY:"America/Denver",DC:"America/New_York",
};

// ─── ZIP-3 prefix → timezone (first 3 digits of ZIP = approximate state/region) ──
// Covers all US ZIP ranges. Approximate — good for support scheduling.
const ZIP3_TZ: Record<string,string> = {
  // New England / NY / NJ
  "005":"America/New_York","006":"America/New_York","007":"America/New_York",
  "008":"America/New_York","009":"America/New_York",
  "010":"America/New_York","011":"America/New_York","012":"America/New_York",
  "013":"America/New_York","014":"America/New_York","015":"America/New_York",
  "016":"America/New_York","017":"America/New_York","018":"America/New_York",
  "019":"America/New_York","020":"America/New_York","021":"America/New_York",
  "022":"America/New_York","023":"America/New_York","024":"America/New_York",
  "025":"America/New_York","026":"America/New_York","027":"America/New_York",
  "028":"America/New_York","029":"America/New_York","030":"America/New_York",
  "031":"America/New_York","032":"America/New_York","033":"America/New_York",
  "034":"America/New_York","035":"America/New_York","036":"America/New_York",
  "037":"America/New_York","038":"America/New_York","039":"America/New_York",
  "040":"America/New_York","041":"America/New_York","042":"America/New_York",
  "043":"America/New_York","044":"America/New_York","045":"America/New_York",
  "046":"America/New_York","047":"America/New_York","048":"America/New_York",
  "049":"America/New_York",
  // NY
  "100":"America/New_York","101":"America/New_York","102":"America/New_York",
  "103":"America/New_York","104":"America/New_York","105":"America/New_York",
  "106":"America/New_York","107":"America/New_York","108":"America/New_York",
  "109":"America/New_York","110":"America/New_York","111":"America/New_York",
  "112":"America/New_York","113":"America/New_York","114":"America/New_York",
  "115":"America/New_York","116":"America/New_York","117":"America/New_York",
  "118":"America/New_York","119":"America/New_York","120":"America/New_York",
  "121":"America/New_York","122":"America/New_York","123":"America/New_York",
  "124":"America/New_York","125":"America/New_York","126":"America/New_York",
  "127":"America/New_York","128":"America/New_York","129":"America/New_York",
  "130":"America/New_York","131":"America/New_York","132":"America/New_York",
  "133":"America/New_York","134":"America/New_York","135":"America/New_York",
  "136":"America/New_York","137":"America/New_York","138":"America/New_York",
  "139":"America/New_York","140":"America/New_York","141":"America/New_York",
  "142":"America/New_York","143":"America/New_York","144":"America/New_York",
  "145":"America/New_York","146":"America/New_York","147":"America/New_York",
  "148":"America/New_York","149":"America/New_York",
  // PA
  "150":"America/New_York","151":"America/New_York","152":"America/New_York",
  "153":"America/New_York","154":"America/New_York","155":"America/New_York",
  "156":"America/New_York","157":"America/New_York","158":"America/New_York",
  "159":"America/New_York","160":"America/New_York","161":"America/New_York",
  "162":"America/New_York","163":"America/New_York","164":"America/New_York",
  "165":"America/New_York","166":"America/New_York","167":"America/New_York",
  "168":"America/New_York","169":"America/New_York","170":"America/New_York",
  "171":"America/New_York","172":"America/New_York","173":"America/New_York",
  "174":"America/New_York","175":"America/New_York","176":"America/New_York",
  "177":"America/New_York","178":"America/New_York","179":"America/New_York",
  "180":"America/New_York","181":"America/New_York","182":"America/New_York",
  "183":"America/New_York","184":"America/New_York","185":"America/New_York",
  "186":"America/New_York","187":"America/New_York","188":"America/New_York",
  "189":"America/New_York","190":"America/New_York","191":"America/New_York",
  "192":"America/New_York","193":"America/New_York","194":"America/New_York",
  "195":"America/New_York","196":"America/New_York",
  // DE / MD / DC / VA / WV / NC / SC / GA / FL
  "197":"America/New_York","198":"America/New_York","199":"America/New_York",
  "200":"America/New_York","201":"America/New_York","202":"America/New_York",
  "203":"America/New_York","204":"America/New_York","205":"America/New_York",
  "206":"America/New_York","207":"America/New_York","208":"America/New_York",
  "209":"America/New_York","210":"America/New_York","211":"America/New_York",
  "212":"America/New_York","214":"America/New_York","215":"America/New_York",
  "216":"America/New_York","217":"America/New_York","218":"America/New_York",
  "219":"America/New_York",
  "220":"America/New_York","221":"America/New_York","222":"America/New_York",
  "223":"America/New_York","224":"America/New_York","225":"America/New_York",
  "226":"America/New_York","227":"America/New_York","228":"America/New_York",
  "229":"America/New_York","230":"America/New_York","231":"America/New_York",
  "232":"America/New_York","233":"America/New_York","234":"America/New_York",
  "235":"America/New_York","236":"America/New_York","237":"America/New_York",
  "238":"America/New_York","239":"America/New_York","240":"America/New_York",
  "241":"America/New_York","242":"America/New_York","243":"America/New_York",
  "244":"America/New_York","245":"America/New_York","246":"America/New_York",
  "247":"America/New_York","248":"America/New_York","249":"America/New_York",
  "250":"America/New_York","251":"America/New_York","252":"America/New_York",
  "253":"America/New_York","254":"America/New_York","255":"America/New_York",
  "256":"America/New_York","257":"America/New_York","258":"America/New_York",
  "259":"America/New_York","260":"America/New_York","261":"America/New_York",
  "262":"America/New_York","263":"America/New_York","264":"America/New_York",
  "265":"America/New_York","266":"America/New_York","267":"America/New_York",
  "268":"America/New_York",
  "270":"America/New_York","271":"America/New_York","272":"America/New_York",
  "273":"America/New_York","274":"America/New_York","275":"America/New_York",
  "276":"America/New_York","277":"America/New_York","278":"America/New_York",
  "279":"America/New_York","280":"America/New_York","281":"America/New_York",
  "282":"America/New_York","283":"America/New_York","284":"America/New_York",
  "285":"America/New_York","286":"America/New_York","287":"America/New_York",
  "288":"America/New_York","289":"America/New_York",
  "290":"America/New_York","291":"America/New_York","292":"America/New_York",
  "293":"America/New_York","294":"America/New_York","295":"America/New_York",
  "296":"America/New_York","297":"America/New_York","298":"America/New_York",
  "299":"America/New_York",
  "300":"America/New_York","301":"America/New_York","302":"America/New_York",
  "303":"America/New_York","304":"America/New_York","305":"America/New_York",
  "306":"America/New_York","307":"America/New_York","308":"America/New_York",
  "309":"America/New_York","310":"America/New_York","311":"America/New_York",
  "312":"America/New_York","313":"America/New_York","314":"America/New_York",
  "315":"America/New_York","316":"America/New_York","317":"America/New_York",
  "318":"America/New_York","319":"America/New_York",
  // FL (mixed — most ET, panhandle CT)
  "320":"America/New_York","321":"America/New_York","322":"America/New_York",
  "323":"America/New_York","324":"America/New_York","325":"America/New_York",
  "326":"America/New_York","327":"America/New_York","328":"America/New_York",
  "329":"America/New_York","330":"America/New_York","331":"America/New_York",
  "332":"America/New_York","333":"America/New_York","334":"America/New_York",
  "335":"America/New_York","336":"America/New_York","337":"America/New_York",
  "338":"America/New_York","339":"America/New_York",
  "341":"America/New_York","342":"America/New_York","344":"America/New_York",
  "346":"America/New_York","347":"America/New_York","349":"America/New_York",
  // AL / TN / MS / KY
  "350":"America/Chicago","351":"America/Chicago","352":"America/Chicago",
  "354":"America/Chicago","355":"America/Chicago","356":"America/Chicago",
  "357":"America/Chicago","358":"America/Chicago","359":"America/Chicago",
  "360":"America/Chicago","361":"America/Chicago","362":"America/Chicago",
  "363":"America/Chicago","364":"America/Chicago","365":"America/Chicago",
  "366":"America/Chicago","367":"America/Chicago","368":"America/Chicago",
  "369":"America/Chicago",
  "370":"America/Chicago","371":"America/Chicago","372":"America/Chicago",
  "373":"America/New_York","374":"America/New_York",
  "376":"America/Chicago","377":"America/New_York","378":"America/New_York",
  "379":"America/Chicago","380":"America/Chicago","381":"America/Chicago",
  "382":"America/Chicago","383":"America/Chicago","384":"America/Chicago",
  "385":"America/Chicago",
  "386":"America/Chicago","387":"America/Chicago","388":"America/Chicago",
  "389":"America/Chicago","390":"America/Chicago","391":"America/Chicago",
  "392":"America/Chicago","393":"America/Chicago","394":"America/Chicago",
  "395":"America/Chicago","396":"America/Chicago","397":"America/Chicago",
  "398":"America/New_York","399":"America/New_York",
  // KY / OH / IN / MI
  "400":"America/New_York","401":"America/New_York","402":"America/New_York",
  "403":"America/New_York","404":"America/New_York","405":"America/New_York",
  "406":"America/New_York","407":"America/New_York","408":"America/New_York",
  "409":"America/New_York","410":"America/New_York","411":"America/New_York",
  "412":"America/New_York","413":"America/New_York","414":"America/New_York",
  "415":"America/New_York","416":"America/Chicago","417":"America/Chicago",
  "418":"America/New_York","420":"America/Chicago","421":"America/Chicago",
  "422":"America/Chicago","423":"America/Chicago","424":"America/Chicago",
  "425":"America/Chicago","426":"America/Chicago","427":"America/Chicago",
  "430":"America/New_York","431":"America/New_York","432":"America/New_York",
  "433":"America/New_York","434":"America/New_York","435":"America/New_York",
  "436":"America/New_York","437":"America/New_York","438":"America/New_York",
  "439":"America/New_York","440":"America/New_York","441":"America/New_York",
  "442":"America/New_York","443":"America/New_York","444":"America/New_York",
  "445":"America/New_York","446":"America/New_York","447":"America/New_York",
  "448":"America/New_York","449":"America/New_York","450":"America/New_York",
  "451":"America/New_York","452":"America/New_York","453":"America/New_York",
  "454":"America/New_York","455":"America/New_York","456":"America/New_York",
  "457":"America/New_York","458":"America/New_York","459":"America/New_York",
  "460":"America/Indiana/Indianapolis","461":"America/Indiana/Indianapolis",
  "462":"America/Indiana/Indianapolis","463":"America/Indiana/Indianapolis",
  "464":"America/Indiana/Indianapolis","465":"America/Indiana/Indianapolis",
  "466":"America/Indiana/Indianapolis","467":"America/Indiana/Indianapolis",
  "468":"America/Indiana/Indianapolis","469":"America/Indiana/Indianapolis",
  "470":"America/Indiana/Indianapolis","471":"America/Indiana/Indianapolis",
  "472":"America/Indiana/Indianapolis","473":"America/Indiana/Indianapolis",
  "474":"America/Indiana/Indianapolis","475":"America/Indiana/Indianapolis",
  "476":"America/Indiana/Indianapolis","477":"America/Indiana/Indianapolis",
  "478":"America/Indiana/Indianapolis","479":"America/Indiana/Indianapolis",
  "480":"America/Detroit","481":"America/Detroit","482":"America/Detroit",
  "483":"America/Detroit","484":"America/Detroit","485":"America/Detroit",
  "486":"America/Detroit","487":"America/Detroit","488":"America/Detroit",
  "489":"America/Detroit","490":"America/Detroit","491":"America/Detroit",
  "492":"America/Detroit","493":"America/Detroit","494":"America/Detroit",
  "495":"America/Detroit","496":"America/Detroit","497":"America/Detroit",
  "498":"America/Detroit","499":"America/Detroit",
  // IA / WI / MN / SD / ND / MT
  "500":"America/Chicago","501":"America/Chicago","502":"America/Chicago",
  "503":"America/Chicago","504":"America/Chicago","505":"America/Chicago",
  "506":"America/Chicago","507":"America/Chicago","508":"America/Chicago",
  "509":"America/Chicago","510":"America/Chicago","511":"America/Chicago",
  "512":"America/Chicago","513":"America/Chicago","514":"America/Chicago",
  "515":"America/Chicago","516":"America/Chicago","520":"America/Chicago",
  "521":"America/Chicago","522":"America/Chicago","523":"America/Chicago",
  "524":"America/Chicago","525":"America/Chicago","526":"America/Chicago",
  "527":"America/Chicago","528":"America/Chicago",
  "530":"America/Chicago","531":"America/Chicago","532":"America/Chicago",
  "534":"America/Chicago","535":"America/Chicago","537":"America/Chicago",
  "538":"America/Chicago","539":"America/Chicago","540":"America/Chicago",
  "541":"America/Chicago","542":"America/Chicago","543":"America/Chicago",
  "544":"America/Chicago","545":"America/Chicago","546":"America/Chicago",
  "547":"America/Chicago","548":"America/Chicago","549":"America/Chicago",
  "550":"America/Chicago","551":"America/Chicago","553":"America/Chicago",
  "554":"America/Chicago","555":"America/Chicago","556":"America/Chicago",
  "557":"America/Chicago","558":"America/Chicago","559":"America/Chicago",
  "560":"America/Chicago","561":"America/Chicago","562":"America/Chicago",
  "563":"America/Chicago","564":"America/Chicago","565":"America/Chicago",
  "566":"America/Chicago","567":"America/Chicago",
  "570":"America/Chicago","571":"America/Chicago","572":"America/Chicago",
  "573":"America/Chicago","574":"America/Chicago","575":"America/Denver",
  "576":"America/Denver","577":"America/Denver",
  "580":"America/Chicago","581":"America/Chicago","582":"America/Chicago",
  "583":"America/Chicago","584":"America/Chicago","585":"America/Chicago",
  "586":"America/Chicago","587":"America/Denver","588":"America/Denver",
  "590":"America/Denver","591":"America/Denver","592":"America/Denver",
  "593":"America/Denver","594":"America/Denver","595":"America/Denver",
  "596":"America/Denver","597":"America/Denver","598":"America/Denver",
  "599":"America/Denver",
  // IL / MO / KS / NE
  "600":"America/Chicago","601":"America/Chicago","602":"America/Chicago",
  "603":"America/Chicago","604":"America/Chicago","605":"America/Chicago",
  "606":"America/Chicago","607":"America/Chicago","608":"America/Chicago",
  "609":"America/Chicago","610":"America/Chicago","611":"America/Chicago",
  "612":"America/Chicago","613":"America/Chicago","614":"America/Chicago",
  "615":"America/Chicago","616":"America/Chicago","617":"America/Chicago",
  "618":"America/Chicago","619":"America/Chicago","620":"America/Chicago",
  "622":"America/Chicago","623":"America/Chicago","624":"America/Chicago",
  "625":"America/Chicago","626":"America/Chicago","627":"America/Chicago",
  "628":"America/Chicago","629":"America/Chicago",
  "630":"America/Chicago","631":"America/Chicago","633":"America/Chicago",
  "634":"America/Chicago","635":"America/Chicago","636":"America/Chicago",
  "637":"America/Chicago","638":"America/Chicago","639":"America/Chicago",
  "640":"America/Chicago","641":"America/Chicago","644":"America/Chicago",
  "645":"America/Chicago","646":"America/Chicago","647":"America/Chicago",
  "648":"America/Chicago","649":"America/Chicago","650":"America/Chicago",
  "651":"America/Chicago","652":"America/Chicago","653":"America/Chicago",
  "654":"America/Chicago","655":"America/Chicago","656":"America/Chicago",
  "657":"America/Chicago","658":"America/Chicago",
  "660":"America/Chicago","661":"America/Chicago","662":"America/Chicago",
  "664":"America/Chicago","665":"America/Chicago","666":"America/Chicago",
  "667":"America/Chicago","668":"America/Chicago","669":"America/Denver",
  "670":"America/Chicago","671":"America/Chicago","672":"America/Chicago",
  "673":"America/Chicago","674":"America/Chicago","675":"America/Chicago",
  "676":"America/Chicago","677":"America/Chicago","678":"America/Denver",
  "679":"America/Denver",
  "680":"America/Chicago","681":"America/Chicago","683":"America/Chicago",
  "684":"America/Chicago","685":"America/Chicago","686":"America/Chicago",
  "687":"America/Chicago","688":"America/Denver","689":"America/Denver",
  "690":"America/Denver","691":"America/Denver","692":"America/Denver",
  "693":"America/Denver",
  // LA / AR / OK / TX
  "700":"America/Chicago","701":"America/Chicago","703":"America/Chicago",
  "704":"America/Chicago","705":"America/Chicago","706":"America/Chicago",
  "707":"America/Chicago","708":"America/Chicago","710":"America/Chicago",
  "711":"America/Chicago","712":"America/Chicago","713":"America/Chicago",
  "714":"America/Chicago",
  "716":"America/Chicago","717":"America/Chicago","718":"America/Chicago",
  "719":"America/Chicago","720":"America/Chicago","721":"America/Chicago",
  "722":"America/Chicago","723":"America/Chicago","724":"America/Chicago",
  "725":"America/Chicago","726":"America/Chicago","727":"America/Chicago",
  "728":"America/Chicago","729":"America/Chicago",
  "730":"America/Chicago","731":"America/Chicago","733":"America/Chicago",
  "734":"America/Chicago","735":"America/Chicago","736":"America/Chicago",
  "737":"America/Chicago","738":"America/Chicago","739":"America/Chicago",
  "740":"America/Chicago","741":"America/Chicago","743":"America/Chicago",
  "744":"America/Chicago","745":"America/Chicago","746":"America/Chicago",
  "747":"America/Chicago","748":"America/Chicago","749":"America/Chicago",
  "750":"America/Chicago","751":"America/Chicago","752":"America/Chicago",
  "753":"America/Chicago","754":"America/Chicago","755":"America/Chicago",
  "756":"America/Chicago","757":"America/Chicago","758":"America/Chicago",
  "759":"America/Chicago","760":"America/Chicago","761":"America/Chicago",
  "762":"America/Chicago","763":"America/Chicago","764":"America/Chicago",
  "765":"America/Chicago","766":"America/Chicago","767":"America/Chicago",
  "768":"America/Chicago","769":"America/Chicago","770":"America/Chicago",
  "772":"America/Chicago","773":"America/Chicago","774":"America/Chicago",
  "775":"America/Chicago","776":"America/Chicago","777":"America/Chicago",
  "778":"America/Chicago","779":"America/Chicago","780":"America/Chicago",
  "781":"America/Chicago","782":"America/Chicago","783":"America/Chicago",
  "784":"America/Chicago","785":"America/Chicago","786":"America/Chicago",
  "787":"America/Chicago","788":"America/Chicago","789":"America/Chicago",
  "790":"America/Chicago","791":"America/Chicago","792":"America/Chicago",
  "793":"America/Chicago","794":"America/Chicago","795":"America/Chicago",
  "796":"America/Chicago","797":"America/Chicago","798":"America/Denver",
  "799":"America/Denver",
  // CO / WY / ID / UT / AZ / NM
  "800":"America/Denver","801":"America/Denver","802":"America/Denver",
  "803":"America/Denver","804":"America/Denver","805":"America/Denver",
  "806":"America/Denver","807":"America/Denver","808":"America/Denver",
  "809":"America/Denver","810":"America/Denver","811":"America/Denver",
  "812":"America/Denver","813":"America/Denver","814":"America/Denver",
  "815":"America/Denver","816":"America/Denver",
  "820":"America/Denver","821":"America/Denver","822":"America/Denver",
  "823":"America/Denver","824":"America/Denver","825":"America/Denver",
  "826":"America/Denver","827":"America/Denver","828":"America/Denver",
  "829":"America/Denver","830":"America/Denver","831":"America/Denver",
  "832":"America/Denver","833":"America/Denver","834":"America/Denver",
  "835":"America/Denver","836":"America/Denver","837":"America/Denver",
  "838":"America/Los_Angeles",
  "840":"America/Denver","841":"America/Denver","842":"America/Denver",
  "843":"America/Denver","844":"America/Denver","845":"America/Denver",
  "846":"America/Denver","847":"America/Denver",
  "850":"America/Phoenix","851":"America/Phoenix","852":"America/Phoenix",
  "853":"America/Phoenix","855":"America/Phoenix","856":"America/Phoenix",
  "857":"America/Phoenix","859":"America/Phoenix","860":"America/Phoenix",
  "863":"America/Phoenix","864":"America/Phoenix","865":"America/Phoenix",
  "870":"America/Denver","871":"America/Denver","872":"America/Denver",
  "873":"America/Denver","874":"America/Denver","875":"America/Denver",
  "876":"America/Denver","877":"America/Denver","878":"America/Denver",
  "879":"America/Denver","880":"America/Denver","881":"America/Denver",
  "882":"America/Denver","883":"America/Denver","884":"America/Denver",
  // NV / CA / OR / WA / HI / AK
  "885":"America/Los_Angeles","889":"America/Los_Angeles",
  "890":"America/Los_Angeles","891":"America/Los_Angeles",
  "893":"America/Los_Angeles","894":"America/Los_Angeles",
  "895":"America/Los_Angeles","896":"America/Los_Angeles",
  "897":"America/Los_Angeles","898":"America/Los_Angeles",
  "900":"America/Los_Angeles","901":"America/Los_Angeles",
  "902":"America/Los_Angeles","903":"America/Los_Angeles",
  "904":"America/Los_Angeles","905":"America/Los_Angeles",
  "906":"America/Los_Angeles","907":"America/Los_Angeles",
  "908":"America/Los_Angeles","909":"America/Los_Angeles",
  "910":"America/Los_Angeles","911":"America/Los_Angeles",
  "912":"America/Los_Angeles","913":"America/Los_Angeles",
  "914":"America/Los_Angeles","915":"America/Los_Angeles",
  "916":"America/Los_Angeles","917":"America/Los_Angeles",
  "918":"America/Los_Angeles","919":"America/Los_Angeles",
  "920":"America/Los_Angeles","921":"America/Los_Angeles",
  "922":"America/Los_Angeles","923":"America/Los_Angeles",
  "924":"America/Los_Angeles","925":"America/Los_Angeles",
  "926":"America/Los_Angeles","927":"America/Los_Angeles",
  "928":"America/Los_Angeles","930":"America/Los_Angeles",
  "931":"America/Los_Angeles","932":"America/Los_Angeles",
  "933":"America/Los_Angeles","934":"America/Los_Angeles",
  "935":"America/Los_Angeles","936":"America/Los_Angeles",
  "937":"America/Los_Angeles","938":"America/Los_Angeles",
  "939":"America/Los_Angeles","940":"America/Los_Angeles",
  "941":"America/Los_Angeles","942":"America/Los_Angeles",
  "943":"America/Los_Angeles","944":"America/Los_Angeles",
  "945":"America/Los_Angeles","946":"America/Los_Angeles",
  "947":"America/Los_Angeles","948":"America/Los_Angeles",
  "949":"America/Los_Angeles","950":"America/Los_Angeles",
  "951":"America/Los_Angeles","952":"America/Los_Angeles",
  "953":"America/Los_Angeles","954":"America/Los_Angeles",
  "955":"America/Los_Angeles","956":"America/Los_Angeles",
  "957":"America/Los_Angeles","958":"America/Los_Angeles",
  "959":"America/Los_Angeles","960":"America/Los_Angeles",
  "961":"America/Los_Angeles",
  "967":"Pacific/Honolulu","968":"Pacific/Honolulu",
  "970":"America/Los_Angeles","971":"America/Los_Angeles",
  "972":"America/Los_Angeles","973":"America/Los_Angeles",
  "974":"America/Los_Angeles","975":"America/Los_Angeles",
  "976":"America/Los_Angeles","977":"America/Los_Angeles",
  "978":"America/Los_Angeles","979":"America/Los_Angeles",
  "980":"America/Los_Angeles","981":"America/Los_Angeles",
  "982":"America/Los_Angeles","983":"America/Los_Angeles",
  "984":"America/Los_Angeles","985":"America/Los_Angeles",
  "986":"America/Los_Angeles","988":"America/Los_Angeles",
  "989":"America/Los_Angeles","990":"America/Los_Angeles",
  "991":"America/Los_Angeles","992":"America/Los_Angeles",
  "993":"America/Los_Angeles","994":"America/Los_Angeles",
  "995":"America/Anchorage","996":"America/Anchorage",
  "997":"America/Anchorage","998":"America/Anchorage","999":"America/Anchorage",
};

// ─── City → timezone ──────────────────────────────────────────────────────────
const CITY_TZ: Record<string,string> = {
  "toronto":"America/Toronto","ottawa":"America/Toronto","vancouver":"America/Vancouver",
  "montreal":"America/Toronto","calgary":"America/Edmonton","edmonton":"America/Edmonton",
  "winnipeg":"America/Winnipeg","halifax":"America/Halifax",
  "london":"Europe/London","paris":"Europe/Paris","berlin":"Europe/Berlin",
  "madrid":"Europe/Madrid","rome":"Europe/Rome","amsterdam":"Europe/Amsterdam",
  "brussels":"Europe/Brussels","zurich":"Europe/Zurich","vienna":"Europe/Vienna",
  "stockholm":"Europe/Stockholm","oslo":"Europe/Oslo","helsinki":"Europe/Helsinki",
  "athens":"Europe/Athens","lisbon":"Europe/Lisbon","prague":"Europe/Prague",
  "warsaw":"Europe/Warsaw","budapest":"Europe/Budapest","bucharest":"Europe/Bucharest",
  "dubai":"Asia/Dubai","mumbai":"Asia/Kolkata","delhi":"Asia/Kolkata",
  "bangalore":"Asia/Kolkata","hyderabad":"Asia/Kolkata","chennai":"Asia/Kolkata",
  "kolkata":"Asia/Kolkata","ahmedabad":"Asia/Kolkata","pune":"Asia/Kolkata",
  "singapore":"Asia/Singapore","hong kong":"Asia/Hong_Kong","tokyo":"Asia/Tokyo",
  "osaka":"Asia/Tokyo","seoul":"Asia/Seoul","beijing":"Asia/Shanghai",
  "shanghai":"Asia/Shanghai","sydney":"Australia/Sydney","melbourne":"Australia/Melbourne",
  "brisbane":"Australia/Brisbane","perth":"Australia/Perth","auckland":"Pacific/Auckland",
  "jakarta":"Asia/Jakarta","bangkok":"Asia/Bangkok","manila":"Asia/Manila",
  "kuala lumpur":"Asia/Kuala_Lumpur","ho chi minh":"Asia/Ho_Chi_Minh","hanoi":"Asia/Bangkok",
  "karachi":"Asia/Karachi","lahore":"Asia/Karachi","islamabad":"Asia/Karachi",
  "dhaka":"Asia/Dhaka","colombo":"Asia/Colombo","kathmandu":"Asia/Kathmandu",
  "tehran":"Asia/Tehran","riyadh":"Asia/Riyadh","doha":"Asia/Qatar",
  "kuwait city":"Asia/Kuwait","amman":"Asia/Amman","beirut":"Asia/Beirut",
  "istanbul":"Europe/Istanbul","moscow":"Europe/Moscow","kyiv":"Europe/Kiev",
  "cairo":"Africa/Cairo","lagos":"Africa/Lagos","nairobi":"Africa/Nairobi",
  "johannesburg":"Africa/Johannesburg","accra":"Africa/Accra",
  "mexico city":"America/Mexico_City","guadalajara":"America/Mexico_City",
  "monterrey":"America/Monterrey","bogota":"America/Bogota","lima":"America/Lima",
  "santiago":"America/Santiago","sao paulo":"America/Sao_Paulo",
  "rio de janeiro":"America/Sao_Paulo",
  "buenos aires":"America/Argentina/Buenos_Aires","caracas":"America/Caracas",
  "phoenix":"America/Phoenix","los angeles":"America/Los_Angeles",
  "san francisco":"America/Los_Angeles","san jose":"America/Los_Angeles",
  "san diego":"America/Los_Angeles","seattle":"America/Los_Angeles",
  "portland":"America/Los_Angeles","las vegas":"America/Los_Angeles",
  "denver":"America/Denver","salt lake city":"America/Denver",
  "chicago":"America/Chicago","houston":"America/Chicago",
  "dallas":"America/Chicago","san antonio":"America/Chicago",
  "austin":"America/Chicago","new orleans":"America/Chicago",
  "minneapolis":"America/Chicago","kansas city":"America/Chicago",
  "new york":"America/New_York","new york city":"America/New_York",
  "nyc":"America/New_York",
  "miami":"America/New_York","atlanta":"America/New_York",
  "boston":"America/New_York","philadelphia":"America/New_York",
  "washington":"America/New_York","charlotte":"America/New_York",
  "detroit":"America/Detroit","columbus":"America/New_York",
  "indianapolis":"America/Indiana/Indianapolis",
  "nashville":"America/Chicago","memphis":"America/Chicago",
  "oklahoma city":"America/Chicago","omaha":"America/Chicago",
  "albuquerque":"America/Denver","tucson":"America/Phoenix",
  "honolulu":"Pacific/Honolulu","anchorage":"America/Anchorage",
};

// ─── Country → timezone ───────────────────────────────────────────────────────
const COUNTRY_TZ: Record<string,string> = {
  "uk":"Europe/London","england":"Europe/London","scotland":"Europe/London",
  "wales":"Europe/London","ireland":"Europe/Dublin","canada":"America/Toronto",
  "france":"Europe/Paris","germany":"Europe/Berlin","spain":"Europe/Madrid",
  "italy":"Europe/Rome","netherlands":"Europe/Amsterdam","belgium":"Europe/Brussels",
  "switzerland":"Europe/Zurich","austria":"Europe/Vienna","sweden":"Europe/Stockholm",
  "norway":"Europe/Oslo","denmark":"Europe/Copenhagen","finland":"Europe/Helsinki",
  "poland":"Europe/Warsaw","czech republic":"Europe/Prague","czechia":"Europe/Prague",
  "portugal":"Europe/Lisbon","greece":"Europe/Athens","turkey":"Europe/Istanbul",
  "russia":"Europe/Moscow","ukraine":"Europe/Kiev","india":"Asia/Kolkata",
  "pakistan":"Asia/Karachi","bangladesh":"Asia/Dhaka","sri lanka":"Asia/Colombo",
  "nepal":"Asia/Kathmandu","china":"Asia/Shanghai","japan":"Asia/Tokyo",
  "south korea":"Asia/Seoul","korea":"Asia/Seoul","singapore":"Asia/Singapore",
  "thailand":"Asia/Bangkok","vietnam":"Asia/Ho_Chi_Minh","indonesia":"Asia/Jakarta",
  "philippines":"Asia/Manila","malaysia":"Asia/Kuala_Lumpur",
  "australia":"Australia/Sydney","new zealand":"Pacific/Auckland",
  "uae":"Asia/Dubai","united arab emirates":"Asia/Dubai",
  "saudi arabia":"Asia/Riyadh","qatar":"Asia/Qatar","kuwait":"Asia/Kuwait",
  "egypt":"Africa/Cairo","nigeria":"Africa/Lagos","kenya":"Africa/Nairobi",
  "south africa":"Africa/Johannesburg","ghana":"Africa/Accra",
  "mexico":"America/Mexico_City","brazil":"America/Sao_Paulo",
  "argentina":"America/Argentina/Buenos_Aires","colombia":"America/Bogota",
  "peru":"America/Lima","chile":"America/Santiago","venezuela":"America/Caracas",
};

// ─── State ZIP code label map ─────────────────────────────────────────────────
const ZIP3_STATE: Record<string,string> = {
  // rough mapping for display purposes
  "005":"CT","006":"PR","007":"PR","008":"VI","009":"PR",
  "010":"MA","011":"MA","012":"MA","013":"MA","014":"MA","015":"MA","016":"MA","017":"MA","018":"MA","019":"MA",
  "020":"MA","021":"MA","022":"MA","023":"MA","024":"MA","025":"MA","026":"MA","027":"MA","028":"RI","029":"RI",
  "030":"NH","031":"NH","032":"NH","033":"NH","034":"NH","035":"NH","036":"NH","037":"NH","038":"NH","039":"ME",
  "040":"ME","041":"ME","042":"ME","043":"ME","044":"ME","045":"ME","046":"ME","047":"ME","048":"ME","049":"ME",
  "100":"NY","101":"NY","102":"NY","103":"NY","104":"NY","105":"NY","106":"NY","107":"NY","108":"NY","109":"NY",
  "110":"NY","111":"NY","112":"NY","113":"NY","114":"NY","115":"NY","116":"NY","117":"NY","118":"NY","119":"NY",
  "120":"NY","121":"NY","122":"NY","123":"NY","124":"NY","125":"NY","126":"NY","127":"NY","128":"NY","129":"NY",
  "130":"NY","131":"NY","132":"NY","133":"NY","134":"NY","135":"NY","136":"NY","137":"NY","138":"NY","139":"NY",
  "140":"NY","141":"NY","142":"NY","143":"NY","144":"NY","145":"NY","146":"NY","147":"NY","148":"NY","149":"NY",
  "197":"DE","198":"DE","199":"DE",
  "200":"DC","201":"VA","202":"DC","203":"DC","204":"DC","205":"DC","206":"MD","207":"MD","208":"MD","209":"MD",
  "210":"MD","211":"MD","212":"MD","214":"MD","215":"MD","216":"MD","217":"MD","218":"MD","219":"MD",
  "320":"FL","321":"FL","322":"FL","323":"FL","324":"FL","325":"FL","326":"FL","327":"FL","328":"FL","329":"FL",
  "330":"FL","331":"FL","332":"FL","333":"FL","334":"FL","335":"FL","336":"FL","337":"FL","338":"FL","339":"FL",
  "850":"AZ","851":"AZ","852":"AZ","853":"AZ","855":"AZ","856":"AZ","857":"AZ","859":"AZ","860":"AZ","865":"AZ",
  "967":"HI","968":"HI",
  "995":"AK","996":"AK","997":"AK","998":"AK","999":"AK",
};

// ─── Resolution ───────────────────────────────────────────────────────────────
interface ResolveResult {
  ok: boolean;
  ambiguous?: boolean;
  ambiguousOptions?: string[];
  timezone?: string;
  tzLabel?: string;
  azNote?: boolean;
  errorMsg?: string;
}

function resolveTimezone(raw: string): ResolveResult {
  const input = raw.trim();
  if (!input) return { ok: false, errorMsg: "Enter a location to convert." };
  const lower = input.toLowerCase().replace(/[.,]/g, "");

  // 1. ZIP code (5 digits)
  if (/^\d{5}$/.test(input)) {
    const z3 = input.slice(0, 3);
    const tz = ZIP3_TZ[z3];
    if (tz) {
      const stateAbbr = ZIP3_STATE[z3];
      const label = stateAbbr ? `${tz} (ZIP ${input}, ${stateAbbr})` : `${tz} (ZIP ${input})`;
      return { ok: true, timezone: tz, tzLabel: label, azNote: tz === "America/Phoenix" };
    }
    return { ok: false, errorMsg: `ZIP code ${input} not recognised. Try a city name or state abbreviation.` };
  }

  // 2. Direct IANA timezone
  if (/^[a-z_]+\/[a-z_/]+$/i.test(input)) {
    try {
      Intl.DateTimeFormat("en-US", { timeZone: input });
      return { ok: true, timezone: input, tzLabel: input };
    } catch {
      return { ok: false, errorMsg: `"${input}" is not a recognised IANA timezone.` };
    }
  }

  // 3. "City, ST" or "City, Country"
  const commaMatch = input.match(/^(.+),\s*(.+)$/);
  if (commaMatch) {
    const city = commaMatch[1].trim().toLowerCase();
    const after = commaMatch[2].trim();
    const afterLower = after.toLowerCase();
    const afterUpper = after.toUpperCase();

    // City known directly
    if (CITY_TZ[city]) {
      const tz = CITY_TZ[city];
      return { ok: true, timezone: tz, tzLabel: `${tz} (${commaMatch[1]}, ${after})`, azNote: tz === "America/Phoenix" };
    }
    // "City, ST" — state abbreviation after comma
    if (/^[A-Za-z]{2}$/.test(after.trim())) {
      if (STATE_TZ[afterUpper]) {
        return { ok: true, timezone: STATE_TZ[afterUpper], tzLabel: `${STATE_TZ[afterUpper]} (${commaMatch[1]}, ${afterUpper})`, azNote: afterUpper === "AZ" };
      }
      if (MULTI_TZ_STATES[afterUpper]) {
        return { ok: false, ambiguous: true, ambiguousOptions: MULTI_TZ_STATES[afterUpper], errorMsg: `${afterUpper} spans multiple timezones. Add a city for precision.` };
      }
    }
    // Country
    if (COUNTRY_TZ[afterLower]) {
      return { ok: true, timezone: COUNTRY_TZ[afterLower], tzLabel: `${COUNTRY_TZ[afterLower]} (${commaMatch[1]}, ${after})` };
    }
    // Country with city fallback
    if (CITY_TZ[city]) return { ok: true, timezone: CITY_TZ[city], tzLabel: `${CITY_TZ[city]} (${input})` };
  }

  // 4. 2-letter state abbreviation
  if (/^[A-Za-z]{2}$/.test(input)) {
    const abbr = input.toUpperCase();
    if (MULTI_TZ_STATES[abbr]) {
      return { ok: false, ambiguous: true, ambiguousOptions: MULTI_TZ_STATES[abbr], errorMsg: `${abbr} spans multiple timezones — add a city for an exact match.` };
    }
    if (STATE_TZ[abbr]) {
      return { ok: true, timezone: STATE_TZ[abbr], tzLabel: `${STATE_TZ[abbr]} (${STATE_ABBR[abbr] ?? abbr})`, azNote: abbr === "AZ" };
    }
  }

  // 5. Full US state name
  if (STATE_NAME_TO_ABBR[lower]) {
    const abbr = STATE_NAME_TO_ABBR[lower];
    if (MULTI_TZ_STATES[abbr]) {
      return { ok: false, ambiguous: true, ambiguousOptions: MULTI_TZ_STATES[abbr], errorMsg: `${input} spans multiple timezones — add a city for an exact match.` };
    }
    if (STATE_TZ[abbr]) {
      return { ok: true, timezone: STATE_TZ[abbr], tzLabel: `${STATE_TZ[abbr]} (${input})`, azNote: abbr === "AZ" };
    }
  }

  // 6. City or country standalone
  if (CITY_TZ[lower]) return { ok: true, timezone: CITY_TZ[lower], tzLabel: `${CITY_TZ[lower]} (${input})`, azNote: CITY_TZ[lower] === "America/Phoenix" };
  if (COUNTRY_TZ[lower]) return { ok: true, timezone: COUNTRY_TZ[lower], tzLabel: `${COUNTRY_TZ[lower]} (${input})` };

  // 7. Partial city match
  const partialCity = Object.keys(CITY_TZ).find(k => k.includes(lower) || lower.includes(k));
  if (partialCity) return { ok: true, timezone: CITY_TZ[partialCity], tzLabel: `${CITY_TZ[partialCity]} (${input})` };

  return { ok: false, errorMsg: `Could not find timezone for "${input}". Try a ZIP code, state abbreviation (CA), full state name, or city name.` };
}

// ─── Time helpers ─────────────────────────────────────────────────────────────
function formatTZ(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: true, timeZoneName: "short",
  }).format(date);
}

function getOffsetMins(date: Date, tz: string): number {
  const utc = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const local = new Date(date.toLocaleString("en-US", { timeZone: tz }));
  return (local.getTime() - utc.getTime()) / 60000;
}

function getPTLabel(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "short" }).formatToParts(date);
  return parts.find(p => p.type === "timeZoneName")?.value ?? "PT";
}

const TIMEZONE_ALIAS_MAP: Record<string, string> = {
  UTC: "UTC",
  GMT: "Etc/GMT",
  BST: "Europe/London",
  IST: "Asia/Kolkata",
  CET: "Europe/Paris",
  CEST: "Europe/Paris",
  EET: "Europe/Athens",
  GST: "Asia/Dubai",
  PKT: "Asia/Karachi",
  WIB: "Asia/Jakarta",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  EST: "America/New_York",
  EDT: "America/New_York",
  MST: "America/Denver",
  MDT: "America/Denver",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  AKST: "America/Anchorage",
  HST: "Pacific/Honolulu",
  JST: "Asia/Tokyo",
  KST: "Asia/Seoul",
  AEST: "Australia/Sydney",
  AEDT: "Australia/Sydney",
};

const COMMON_TIMEZONE_OPTIONS = [
  { value: "UTC", label: "UTC" },
  { value: "Etc/GMT", label: "GMT" },
  { value: "America/New_York", label: "EST / EDT — Eastern Time" },
  { value: "America/Chicago", label: "CST / CDT — Central Time" },
  { value: "America/Denver", label: "MST / MDT — Mountain Time" },
  { value: "America/Los_Angeles", label: "PST / PDT — Pacific Time" },
  { value: "America/Anchorage", label: "AKST / AKDT — Alaska" },
  { value: "Pacific/Honolulu", label: "HST — Hawaii" },
  { value: "Europe/London", label: "BST / GMT — London" },
  { value: "Europe/Paris", label: "CET / CEST — Paris" },
  { value: "Europe/Athens", label: "EET / EEST — Athens" },
  { value: "Asia/Dubai", label: "GST — Dubai" },
  { value: "Asia/Kolkata", label: "IST — India" },
  { value: "Asia/Karachi", label: "PKT — Pakistan" },
  { value: "Asia/Singapore", label: "SGT — Singapore" },
  { value: "Asia/Manila", label: "PHT — Manila" },
  { value: "Asia/Hong_Kong", label: "HKT — Hong Kong" },
  { value: "Asia/Shanghai", label: "CST — China Standard Time" },
  { value: "Asia/Tokyo", label: "JST — Tokyo" },
  { value: "Asia/Seoul", label: "KST — Seoul" },
  { value: "Australia/Sydney", label: "AEST / AEDT — Sydney" },
  { value: "Pacific/Auckland", label: "NZST / NZDT — Auckland" },
];

function getTimezoneOptions() {
  const intlWithSupportedValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  const dynamic = typeof intlWithSupportedValues.supportedValuesOf === "function"
    ? intlWithSupportedValues.supportedValuesOf("timeZone").map((tz: string) => ({ value: tz, label: tz }))
    : [];

  const map = new Map<string, { value: string; label: string }>();
  for (const option of [...COMMON_TIMEZONE_OPTIONS, ...dynamic]) {
    if (!map.has(option.value)) map.set(option.value, option);
  }
  return Array.from(map.values());
}

function normalizeTimezoneInput(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (TIMEZONE_ALIAS_MAP[upper]) return TIMEZONE_ALIAS_MAP[upper];
  return raw;
}


function formatConverterDateTime(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
}

function getDatePartsInTimezone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
  };
}

function buildSourceInstantFromTimezoneWallTime(dateStr: string, timeStr: string, sourceTz: string): Date | null {
  if (!dateStr || !timeStr || !sourceTz) return null;

  const dateMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeStr.match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if ([year, month, day, hour, minute].some(Number.isNaN)) return null;

  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let i = 0; i < 4; i += 1) {
    const seen = getDatePartsInTimezone(guess, sourceTz);
    const desiredUtcMinutes = Date.UTC(year, month - 1, day, hour, minute, 0) / 60000;
    const seenUtcMinutes = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, 0) / 60000;
    const delta = desiredUtcMinutes - seenUtcMinutes;
    if (delta === 0) break;
    guess = new Date(guess.getTime() + delta * 60000);
  }

  return guess;
}

function getSupportStatus(date: Date): "within" | "boundary" | "outside" {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(date);
  const h = parseInt(parts.find(p => p.type === "hour")?.value ?? "0");
  const m = parseInt(parts.find(p => p.type === "minute")?.value ?? "0");
  const total = h * 60 + m;
  if (total >= 8*60 && total <= 18*60) {
    if (total <= 9*60 || total >= 17*60) return "boundary";
    return "within";
  }
  return "outside";
}

interface ConversionResult {
  customerLocal: string; ptTime: string; pstFixed: string; ptLabel: string;
  diffLabel: string; supportStatus: "within"|"boundary"|"outside";
  timezone: string; tzLabel: string; azNote: boolean;
}

function doConvert(timezone: string, tzLabel: string, azNote: boolean): ConversionResult {
  const date = new Date();
  const ptLabel = getPTLabel(date);
  const customerLocal = formatTZ(date, timezone);
  const ptTime = formatTZ(date, "America/Los_Angeles");
  const pstDate = new Date(date.getTime() - 8 * 3600000);
  const pstFixed = pstDate.toUTCString().replace("GMT", "PST (UTC-8)");
  const custOff = getOffsetMins(date, timezone);
  const ptOff = getOffsetMins(date, "America/Los_Angeles");
  const diffMins = custOff - ptOff;
  const sign = diffMins >= 0 ? "+" : "-";
  const abs = Math.abs(diffMins);
  const hrs = Math.floor(abs / 60);
  const mins = abs % 60;
  const diffLabel = mins === 0 ? `${sign}${hrs}h vs ${ptLabel}` : `${sign}${hrs}h ${mins}m vs ${ptLabel}`;
  return { customerLocal, ptTime, pstFixed, ptLabel, diffLabel, supportStatus: getSupportStatus(date), timezone, tzLabel, azNote };
}



// ─── Helpers to format time nicely ───────────────────────────────────────────
function formatTimeOnly(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
}

function formatDateOnly(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function getTzAbbr(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(date);
  return parts.find(p => p.type === "timeZoneName")?.value ?? "";
}

/** Returns 0–100 progress of current PT time within 08:00–18:00 window */
function getPTWorkdayProgress(date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", hour12: false });
  const parts = formatter.formatToParts(date);
  const h = parseInt(parts.find(p => p.type === "hour")?.value ?? "0");
  const m = parseInt(parts.find(p => p.type === "minute")?.value ?? "0");
  const total = h * 60 + m;
  const start = 8 * 60, end = 18 * 60;
  if (total < start) return 0;
  if (total > end) return 100;
  return Math.round(((total - start) / (end - start)) * 100);
}

// ─── Main widget ──────────────────────────────────────────────────────────────
export function TimezoneHelperWidget(_props: { onCollapse?: () => void }) {
  const timezoneOptions = useMemo(() => getTimezoneOptions(), []);
  const [helperTab] = useState<string>("lookup");
  const [fromTimezone, setFromTimezone] = useState<string>("Etc/GMT");
  const [toTimezone, setToTimezone] = useState<string>("America/Chicago");
  const [converterDate, setConverterDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [converterTime, setConverterTime] = useState<string>(() => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  });
  const [converterError, setConverterError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [location, setLocation] = useState("");
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [resolvedRef, setResolvedRef] = useState<ResolveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState<string[] | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live tick — refreshes every second
  const startTick = useCallback((resolved: ResolveResult) => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      if (resolved.ok && resolved.timezone) {
        setResult(doConvert(resolved.timezone, resolved.tzLabel!, !!resolved.azNote));
      }
    }, 1000);
  }, []);

  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const runFor = useCallback((loc: string) => {
    setError(null);
    setAmbiguous(null);
    const resolved = resolveTimezone(loc);
    if (!resolved.ok) {
      setResult(null);
      setResolvedRef(null);
      if (tickRef.current) clearInterval(tickRef.current);
      if (resolved.ambiguous) setAmbiguous(resolved.ambiguousOptions ?? []);
      setError(resolved.errorMsg ?? "Unknown error");
      return;
    }
    const r = doConvert(resolved.timezone!, resolved.tzLabel!, !!resolved.azNote);
    setResult(r);
    setResolvedRef(resolved);
    startTick(resolved);
    // Add to recents (deduplicated, max 5)
    setRecents(prev => {
      const deduped = [loc, ...prev.filter(x => x.toLowerCase() !== loc.toLowerCase())];
      return deduped.slice(0, 5);
    });
  }, [startTick]);

  // Auto-convert with 400ms debounce as user types
  const handleChange = useCallback((val: string) => {
    setLocation(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) { setResult(null); setError(null); setAmbiguous(null); return; }
    debounceRef.current = setTimeout(() => runFor(val.trim()), 400);
  }, [runFor]);

  const supportStatus = result?.supportStatus ?? "outside";
  const statusColor = supportStatus === "within" ? "teal" : supportStatus === "boundary" ? "yellow" : "red";
  const ptProgress = result ? getPTWorkdayProgress(new Date()) : 0;

  const normalizedFromTimezone = normalizeTimezoneInput(fromTimezone);
  const normalizedToTimezone = normalizeTimezoneInput(toTimezone);

  const converterCurrentResult = useMemo(() => {
    if (!normalizedFromTimezone || !normalizedToTimezone) return null;
    try {
      const now = new Date(nowTick);
      Intl.DateTimeFormat("en-US", { timeZone: normalizedFromTimezone }).format(now);
      Intl.DateTimeFormat("en-US", { timeZone: normalizedToTimezone }).format(now);
      return {
        source: formatConverterDateTime(now, normalizedFromTimezone),
        target: formatConverterDateTime(now, normalizedToTimezone),
        sourceAbbr: getTzAbbr(now, normalizedFromTimezone),
        targetAbbr: getTzAbbr(now, normalizedToTimezone),
      };
    } catch {
      return null;
    }
  }, [normalizedFromTimezone, normalizedToTimezone, nowTick]);

  const converterSpecificResult = useMemo(() => {
    if (!normalizedFromTimezone || !normalizedToTimezone) return null;
    try {
      const sourceInstant = buildSourceInstantFromTimezoneWallTime(converterDate, converterTime, normalizedFromTimezone);
      if (!sourceInstant) return null;
      Intl.DateTimeFormat("en-US", { timeZone: normalizedFromTimezone }).format(sourceInstant);
      Intl.DateTimeFormat("en-US", { timeZone: normalizedToTimezone }).format(sourceInstant);
      return {
        source: formatConverterDateTime(sourceInstant, normalizedFromTimezone),
        target: formatConverterDateTime(sourceInstant, normalizedToTimezone),
        sourceAbbr: getTzAbbr(sourceInstant, normalizedFromTimezone),
        targetAbbr: getTzAbbr(sourceInstant, normalizedToTimezone),
      };
    } catch {
      return null;
    }
  }, [normalizedFromTimezone, normalizedToTimezone, converterDate, converterTime]);

  useEffect(() => {
    if (!normalizedFromTimezone || !normalizedToTimezone) {
      setConverterError("Choose both a source and target timezone.");
      return;
    }
    if (!converterCurrentResult) {
      setConverterError("Could not convert that timezone pair. Try selecting valid timezones.");
      return;
    }
    if (!converterSpecificResult) {
      setConverterError("Enter a valid source date/time to convert.");
      return;
    }
    setConverterError(null);
  }, [converterCurrentResult, converterSpecificResult, normalizedFromTimezone, normalizedToTimezone]);

  // Build flat suggestion list from all known data
  const suggestions = useMemo(() => {
    const list: string[] = [];
    // US state abbreviations + full names e.g. "CA — California (Pacific)"
    Object.entries(STATE_ABBR).forEach(([abbr, name]) => {
      list.push(abbr);
      list.push(name);
    });
    // Multi-tz states are already in STATE_ABBR, no extra entries needed
    // Well-known cities (title-cased)
    Object.keys(CITY_TZ).forEach(city => {
      list.push(city.replace(/\b\w/g, c => c.toUpperCase()));
    });
    // Countries
    Object.keys(COUNTRY_TZ).forEach(country => {
      list.push(country.replace(/\b\w/g, c => c.toUpperCase()));
    });
    // Common city+country combos
    list.push("Toronto, Canada", "Vancouver, Canada", "Montreal, Canada");
    list.push("London, UK", "Manchester, UK", "Edinburgh, UK");
    list.push("Sydney, Australia", "Melbourne, Australia", "Brisbane, Australia");
    list.push("Mumbai, India", "Delhi, India", "Bangalore, India", "Hyderabad, India", "Chennai, India");
    list.push("Manila, Philippines", "Singapore, Singapore", "Kuala Lumpur, Malaysia");
    list.push("Dubai, UAE", "Riyadh, Saudi Arabia", "Doha, Qatar");
    // Common city+state combos
    list.push("New York, NY", "Los Angeles, CA", "Chicago, IL", "Houston, TX",
              "Phoenix, AZ", "Philadelphia, PA", "San Antonio, TX", "San Diego, CA",
              "Dallas, TX", "Austin, TX", "Jacksonville, FL", "Miami, FL",
              "Seattle, WA", "Denver, CO", "Boston, MA", "Nashville, TN",
              "Las Vegas, NV", "Portland, OR", "Memphis, TN", "Atlanta, GA");
    // Deduplicate
    return [...new Set(list)].sort((a, b) => a.localeCompare(b));
  }, []);

  const QUICK = ["90210", "10001", "77001", "33101", "CA", "TX", "NY", "London, UK", "India", "Asia/Tokyo"];

  return (
    <WidgetFrame title="NOC Timezone Helper" icon={IconWorldPin} iconColor="cyan">
      <Stack gap="md" p="md">
        {/* ── Input with autocomplete ── */}
        <Autocomplete
          placeholder='ZIP, city, state, or country — e.g. "90210", "CA", "Houston, TX", "London, UK"'
          value={location}
          onChange={val => handleChange(val)}
          onOptionSubmit={val => { setLocation(val); runFor(val); }}
          onKeyDown={e => e.key === "Enter" && runFor(location.trim())}
          data={suggestions}
          limit={8}
          leftSection={<IconMapPin size={14} />}
          rightSection={location ? (
            <Button size="compact-xs" variant="subtle" color="gray" onClick={() => { setLocation(""); setResult(null); setError(null); setAmbiguous(null); if (tickRef.current) clearInterval(tickRef.current); }}>✕</Button>
          ) : undefined}
          radius="md"
          size="md"
          comboboxProps={{ shadow: "md", radius: "md" }}
        />

        {/* ── Quick chips + recents ── */}
        <Stack gap={6}>
          <Group gap={6} wrap="wrap">
            {QUICK.map(ex => (
              <Badge key={ex} variant="light" color="cyan" size="sm" style={{ cursor: "pointer" }}
                onClick={() => { setLocation(ex); runFor(ex); }}>
                {ex}
              </Badge>
            ))}
          </Group>
          {recents.length > 0 && (
            <Group gap={6} wrap="wrap" align="center">
              <IconHistory size={12} color="var(--mantine-color-dimmed)" />
              <Text size="xs" c="dimmed">Recent:</Text>
              {recents.map(r => (
                <Badge key={r} variant="dot" color="gray" size="sm" style={{ cursor: "pointer" }}
                  onClick={() => { setLocation(r); runFor(r); }}>
                  {r}
                </Badge>
              ))}
            </Group>
          )}
        </Stack>

        {/* ── Ambiguous / error ── */}
        {error && (
          <Alert icon={<IconAlertTriangle size={14} />} color={ambiguous ? "yellow" : "red"} variant="light" radius="md">
            <Text size="sm" fw={600}>{error}</Text>
            {ambiguous && ambiguous.length > 0 && (
              <Stack gap={4} mt="xs">
                {ambiguous.map(opt => <Text key={opt} size="xs" c="dimmed">• {opt}</Text>)}
              </Stack>
            )}
          </Alert>
        )}

        {/* ── Result card ── */}
        {helperTab === "lookup" && result && resolvedRef && (
          <Card withBorder radius="lg" p="lg" style={{ borderColor: `var(--mantine-color-${statusColor}-7)` }}>
            {/* Two-panel time display */}
            <Group justify="space-between" align="stretch" wrap="nowrap" gap="xl">
              {/* Left — customer */}
              <Stack gap={2} style={{ flex: 1 }}>
                <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.08em" }}>Customer</Text>
                <Text fw={800} size="28px" style={{ fontVariantNumeric: "tabular-nums", lineHeight: 1.1, fontFamily: "monospace" }}>
                  {formatTimeOnly(new Date(), resolvedRef.timezone!)}
                </Text>
                <Text size="sm" c="dimmed">{formatDateOnly(new Date(), resolvedRef.timezone!)} · {getTzAbbr(new Date(), resolvedRef.timezone!)}</Text>
                <Text size="xs" c="dimmed" lineClamp={1} mt={2}>{resolvedRef.tzLabel}</Text>
                {result.azNote && <Text size="xs" c="yellow.4" mt={2}>⚠ Arizona — no DST (most areas)</Text>}
              </Stack>

              <Divider orientation="vertical" />

              {/* Right — Pacific */}
              <Stack gap={2} style={{ flex: 1, alignItems: "flex-end" }}>
                <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.08em" }}>Pacific Time</Text>
                <Text fw={800} size="28px" style={{ fontVariantNumeric: "tabular-nums", lineHeight: 1.1, fontFamily: "monospace" }}>
                  {formatTimeOnly(new Date(), "America/Los_Angeles")}
                </Text>
                <Text size="sm" c="dimmed">{formatDateOnly(new Date(), "America/Los_Angeles")} · {getTzAbbr(new Date(), "America/Los_Angeles")}</Text>
                <Badge variant="light" color={statusColor} size="sm" mt={2}>{result.diffLabel}</Badge>
              </Stack>
            </Group>

            {/* Workday progress bar */}
            <Stack gap={4} mt="md">
              <Group justify="space-between">
                <Text size="xs" c="dimmed">PT workday (08:00 – 18:00)</Text>
                <Badge size="xs" variant="light" color={statusColor}>
                  {supportStatus === "within" ? "✓ Within hours" : supportStatus === "boundary" ? "⚠ Near boundary" : "✗ Outside hours"}
                </Badge>
              </Group>
              <Progress.Root size="sm" radius="xl">
                <Progress.Section
                  value={ptProgress}
                  color={statusColor}
                  style={{ transition: "width 1s linear" }}
                />
              </Progress.Root>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">8 AM</Text>
                <Text size="xs" c="dimmed">1 PM</Text>
                <Text size="xs" c="dimmed">6 PM</Text>
              </Group>
            </Stack>
          </Card>
        )}

        {/* ── Idle state ── */}
        {!result && !error && (
          <Group gap="xs" c="dimmed" justify="center" py="sm">
            <IconClock size={14} />
            <Text size="xs">Start typing to convert instantly</Text>
          </Group>
        )}

        <Card withBorder radius="lg" p="lg">
          <Stack gap="md">
            <Group justify="space-between" align="center" wrap="wrap">
              <div>
                <Text fw={700}>Timezone converter</Text>
                <Text size="sm" c="dimmed">Convert from any timezone to any timezone, for example GMT to CST.</Text>
              </div>
              <Badge variant="light" color="cyan">Converter</Badge>
            </Group>

            <Group align="end" wrap="wrap">
              <TextInput
                label="Source date"
                type="date"
                value={converterDate}
                onChange={(event) => setConverterDate(event.currentTarget.value)}
                style={{ minWidth: 170 }}
              />
              <TextInput
                label="Source time"
                type="time"
                value={converterTime}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setConverterTime(event.currentTarget.value)}
                style={{ minWidth: 140 }}
              />
              <Select
                label="From"
                searchable
                data={timezoneOptions}
                value={fromTimezone}
                onChange={(value) => {
                  const next = normalizeTimezoneInput(value);
                  if (next) {
                    setFromTimezone(next);
                  }
                }}
                style={{ flex: 1, minWidth: 220 }}
                comboboxProps={{ withinPortal: true }}
              />
              <ActionIcon
                aria-label="Swap timezones"
                variant="light"
                color="cyan"
                size="xl"
                mb={2}
                onClick={() => {
                  setFromTimezone(normalizedToTimezone ?? fromTimezone);
                  setToTimezone(normalizedFromTimezone ?? toTimezone);
                }}
              >
                <IconArrowsExchange size={18} />
              </ActionIcon>
              <Select
                label="To"
                searchable
                data={timezoneOptions}
                value={toTimezone}
                onChange={(value: string | null) => {
                  const next = normalizeTimezoneInput(value);
                  if (next) setToTimezone(next);
                }}
                style={{ flex: 1, minWidth: 220 }}
                comboboxProps={{ withinPortal: true }}
              />
            </Group>

            {converterError ? (
              <Alert color="yellow" variant="light" radius="md" icon={<IconAlertTriangle size={14} />}>
                <Text size="sm">{converterError}</Text>
              </Alert>
            ) : (
              <Stack gap="sm">
                {converterCurrentResult && (
                  <Card withBorder radius="md" p="md">
                    <Stack gap="xs">
                      <Text size="xs" fw={700} c="dimmed" tt="uppercase">Current time conversion (live)</Text>
                      <Group justify="space-between" align="stretch" wrap="wrap" gap="md">
                        <Stack gap={4} style={{ flex: 1, minWidth: 240 }}>
                          <Text size="xs" fw={700} c="dimmed" tt="uppercase">From</Text>
                          <Text fw={800} size="xl" ff="monospace">{converterCurrentResult.source}</Text>
                          <Text size="xs" c="dimmed">{normalizedFromTimezone}{converterCurrentResult.sourceAbbr ? ` · ${converterCurrentResult.sourceAbbr}` : ""}</Text>
                        </Stack>
                        <Divider orientation="vertical" visibleFrom="sm" />
                        <Stack gap={4} style={{ flex: 1, minWidth: 240 }}>
                          <Text size="xs" fw={700} c="dimmed" tt="uppercase">To</Text>
                          <Text fw={800} size="xl" ff="monospace">{converterCurrentResult.target}</Text>
                          <Text size="xs" c="dimmed">{normalizedToTimezone}{converterCurrentResult.targetAbbr ? ` · ${converterCurrentResult.targetAbbr}` : ""}</Text>
                        </Stack>
                      </Group>
                    </Stack>
                  </Card>
                )}

                {converterSpecificResult && (
                  <Card withBorder radius="md" p="md">
                    <Stack gap="xs">
                      <Text size="xs" fw={700} c="dimmed" tt="uppercase">Specific source time conversion</Text>
                      <Group justify="space-between" align="stretch" wrap="wrap" gap="md">
                        <Stack gap={4} style={{ flex: 1, minWidth: 240 }}>
                          <Text size="xs" fw={700} c="dimmed" tt="uppercase">From</Text>
                          <Text fw={800} size="xl" ff="monospace">{converterSpecificResult.source}</Text>
                          <Text size="xs" c="dimmed">{normalizedFromTimezone}{converterSpecificResult.sourceAbbr ? ` · ${converterSpecificResult.sourceAbbr}` : ""}</Text>
                        </Stack>
                        <Divider orientation="vertical" visibleFrom="sm" />
                        <Stack gap={4} style={{ flex: 1, minWidth: 240 }}>
                          <Text size="xs" fw={700} c="dimmed" tt="uppercase">To</Text>
                          <Text fw={800} size="xl" ff="monospace">{converterSpecificResult.target}</Text>
                          <Text size="xs" c="dimmed">{normalizedToTimezone}{converterSpecificResult.targetAbbr ? ` · ${converterSpecificResult.targetAbbr}` : ""}</Text>
                        </Stack>
                      </Group>
                    </Stack>
                  </Card>
                )}
              </Stack>
            )}
          </Stack>
        </Card>

      </Stack>
    </WidgetFrame>
  );
}

// ─── Tile ─────────────────────────────────────────────────────────────────────
export function TimezoneHelperTile({ onExpand }: { onExpand: () => void }) {
  return (
    <Card withBorder radius="lg" p="md" style={{ cursor: "pointer", height: "100%" }} onClick={onExpand}>
      <Group gap="sm" align="flex-start">
        <ThemeIcon size={36} radius="md" variant="light" color="cyan">
          <IconWorldPin size={20} />
        </ThemeIcon>
        <Stack gap={2} style={{ flex: 1 }}>
          <Text fw={700} size="sm">NOC Timezone Helper</Text>
          <Text size="xs" c="dimmed">Timezone converter + ZIP · City · State → PT helper</Text>
          <Group gap={4} mt={4}>
            <Badge size="xs" variant="light" color="green">Within hours</Badge>
            <Badge size="xs" variant="light" color="yellow">Boundary</Badge>
            <Badge size="xs" variant="light" color="red">Outside</Badge>
          </Group>
        </Stack>
      </Group>
    </Card>
  );
}
