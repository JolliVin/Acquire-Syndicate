'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// --- CONSTANTS & UTILITIES ---
const CORPORATIONS = ['Sackson', 'Festival', 'Tower', 'American', 'Worldwide', 'Imperial', 'Continental'];
const BOARD_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const BOARD_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const getTileValue = (tile: string) => {
  const number = parseInt(tile.match(/\d+/)?.[0] || '0');
  const letter = tile.match(/[A-I]/)?.[0] || 'A';
  return (letter.charCodeAt(0) - 65) * 100 + number;
};

const getStockPrice = (corp: string, size: number) => {
  const s = size < 2 ? 2 : size;
  let base = 0;
  if (['Sackson', 'Tower'].includes(corp)) base = 200;
  else if (['Festival', 'Worldwide', 'American'].includes(corp)) base = 300;
  else if (['Imperial', 'Continental'].includes(corp)) base = 400;

  let bonus = 0;
  if (s === 3) bonus = 100;
  else if (s === 4) bonus = 200;
  else if (s === 5) bonus = 300;
  else if (s >= 6 && s <= 10) bonus = 400;
  else if (s >= 11 && s <= 20) bonus = 500;
  else if (s >= 21 && s <= 30) bonus = 600;
  else if (s >= 31 && s <= 40) bonus = 700;
  else if (s >= 41) bonus = 800;

  return base + bonus;
};

// --- TYPES ---
type Player = { 
  id: string; player_name: string; is_host: boolean; money: number; 
  hand: string[]; play_order: number; stocks: Record<string, number>;
};

type Lobby = { 
  id: string; status: string; board_state: string[]; turn_phase: string;
  current_turn_index: number; chain_sizes: Record<string, number>;
  active_chains: string[]; tile_ownership: Record<string, string | null>;
  winner_data: any[]; code: string; available_stocks: Record<string, number>;
  tile_pool: string[]; merger_data: any; disposition_turn_index?: number;
};

export default function Home() {
  const [playerName, setPlayerName] = useState('');
  const [view, setView] = useState<'home' | 'create' | 'join'>('home');
  const [lobbyInfo, setLobbyInfo] = useState<Lobby | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [stocksBoughtThisTurn, setStocksBoughtThisTurn] = useState(0);

  useEffect(() => {
    if (!lobbyInfo) return;
    const fetchData = async () => {
      const { data: p } = await supabase.from('players').select('*').eq('lobby_id', lobbyInfo.id).order('created_at', { ascending: true });
      const { data: l } = await supabase.from('lobbies').select('*').eq('id', lobbyInfo.id).single();
      if (p) setPlayers(p as Player[]);
      if (l) setLobbyInfo(prev => ({ ...prev, ...l }));
    };
    fetchData();

    const sub = supabase.channel('updates')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lobbies', filter: `id=eq.${lobbyInfo.id}` }, (payload) => setLobbyInfo(c => ({ ...c!, ...payload.new })))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `lobby_id=eq.${lobbyInfo.id}` }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [lobbyInfo?.id]);

  // --- END GAME ENGINE ---
  const handleEndGame = async () => {
    if (!lobbyInfo) return;
    
    let finalPlayers = [...players];

    // 1. Final Payouts for all active chains
    lobbyInfo.active_chains.forEach(corp => {
      const payouts = calculateMergerBonuses(corp, finalPlayers);
      payouts.forEach(upd => {
        const p = finalPlayers.find(pl => pl.id === upd.id);
        if (p) p.money += (upd.money - p.money); // Add the calculated bonus
      });
    });

    // 2. Liquidate all stocks
    finalPlayers = finalPlayers.map(p => {
      let liquidationCash = 0;
      CORPORATIONS.forEach(corp => {
        const count = p.stocks[corp] || 0;
        if (count > 0 && lobbyInfo.active_chains.includes(corp)) {
          liquidationCash += count * getStockPrice(corp, lobbyInfo.chain_sizes[corp]);
        }
      });
      return { ...p, money: p.money + liquidationCash };
    });

    const standings = finalPlayers.sort((a, b) => b.money - a.money);

    await supabase.from('lobbies').update({ status: 'finished', winner_data: standings }).eq('id', lobbyInfo.id);
  };

  const checkEndConditions = () => {
    if (!lobbyInfo) return false;
    const has41 = Object.values(lobbyInfo.chain_sizes).some(size => size >= 41);
    const allSafe = lobbyInfo.active_chains.length > 0 && lobbyInfo.active_chains.every(corp => lobbyInfo.chain_sizes[corp] >= 11);
    return has41 || allSafe;
  };

  // Helper for Payouts
  const calculateMergerBonuses = (corp: string, currentPlayers: Player[]) => {
    const price = getStockPrice(corp, lobbyInfo!.chain_sizes[corp]);
    const pBonus = price * 10;
    const sBonus = price * 5;
    const holders = [...currentPlayers].sort((a, b) => (b.stocks[corp] || 0) - (a.stocks[corp] || 0));
    const top = holders[0].stocks[corp] || 0;
    if (top === 0) return [];
    const pList = holders.filter(p => p.stocks[corp] === top);
    if (pList.length > 1) {
      const split = Math.ceil((pBonus + sBonus) / pList.length / 100) * 100;
      return pList.map(p => ({ id: p.id, money: p.money + split }));
    }
    const rem = holders.filter(p => p.id !== pList[0].id);
    const sTop = rem[0]?.stocks[corp] || 0;
    const res = [{ id: pList[0].id, money: pList[0].money + pBonus }];
    if (sTop > 0) {
      const sList = rem.filter(p => p.stocks[corp] === sTop);
      const sSplit = Math.ceil(sBonus / sList.length / 100) * 100;
      sList.forEach(p => res.push({ id: p.id, money: p.money + sSplit }));
    }
    return res;
  };

  // --- CORE GAME ACTIONS (Place, Found, Buy, End Turn) ---
  // (Simplified for integration - same logic as previous steps)
  const getNeighbors = (t: string) => {
    const c = parseInt(t.match(/\d+/)?.[0] || '0');
    const r = BOARD_ROWS.indexOf(t.match(/[A-I]/)?.[0] || 'A');
    const n = [];
    if (c > 1) n.push(`${c-1}${BOARD_ROWS[r]}`);
    if (c < 12) n.push(`${c+1}${BOARD_ROWS[r]}`);
    if (r > 0) n.push(`${c}${BOARD_ROWS[r-1]}`);
    if (r < 8) n.push(`${c}${BOARD_ROWS[r+1]}`);
    return n;
  };

  const handlePlaceTile = async (tile: string) => {
    const cur = players.find(p => p.play_order === lobbyInfo?.current_turn_index);
    if (!lobbyInfo || cur?.player_name !== playerName) return;

    const neighbors = getNeighbors(tile);
    const adjTiles = neighbors.filter(n => lobbyInfo.board_state.includes(n));
    const adjCorps = adjTiles.map(n => lobbyInfo.tile_ownership[n]).filter((c): c is string => !!c);
    const uniqueCorps = Array.from(new Set(adjCorps));

    // Dead Tile Logic: If it merges 2 safe chains
    if (uniqueCorps.filter(c => lobbyInfo.chain_sizes[c] >= 11).length > 1) {
      alert("Illegal Move: Merging Safe Chains!"); return;
    }

    let next = 'buy_stocks';
    if (uniqueCorps.length > 1) next = 'merger_resolution';
    else if (uniqueCorps.length === 0 && adjTiles.length > 0) next = 'found_chain';

    await supabase.from('players').update({ hand: cur.hand.filter(t => t !== tile) }).eq('id', cur.id);
    await supabase.from('lobbies').update({ board_state: [...lobbyInfo.board_state, tile], turn_phase: next }).eq('id', lobbyInfo.id);
  };

  // --- RENDER ---
  return (
    <main className="min-h-screen bg-slate-900 flex items-center justify-center p-4 text-white font-sans">
      <div className={`w-full bg-slate-800 rounded-xl shadow-2xl p-8 transition-all ${lobbyInfo?.status === 'playing' || lobbyInfo?.status === 'finished' ? 'max-w-6xl' : 'max-w-md'}`}>
        <h1 className="text-3xl font-bold text-center mb-8 text-amber-400">ACQUIRE SYNDICATE</h1>

        {/* --- GAME OVER SCREEN --- */}
        {lobbyInfo?.status === 'finished' && (
          <div className="text-center py-10">
            <h2 className="text-5xl font-black text-amber-500 mb-2 italic">GAME OVER</h2>
            <p className="text-slate-400 mb-8 tracking-widest uppercase">Final Board Liquidation Complete</p>
            
            <div className="max-w-md mx-auto space-y-4">
              {lobbyInfo.winner_data.map((p, i) => (
                <div key={p.id} className={`flex justify-between items-center p-4 rounded-lg border-2 ${i === 0 ? 'bg-amber-500/20 border-amber-500 scale-110' : 'bg-slate-700 border-slate-600'}`}>
                  <div className="flex items-center gap-4">
                    <span className="text-2xl font-black italic text-slate-500">#{i+1}</span>
                    <span className="font-bold text-lg">{p.player_name}</span>
                  </div>
                  <span className="font-mono text-xl text-emerald-400">${p.money.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <button onClick={() => window.location.reload()} className="mt-12 bg-slate-700 px-8 py-3 rounded-full font-bold hover:bg-slate-600 transition-all">RETURN TO MAIN MENU</button>
          </div>
        )}

        {/* --- PLAYING VIEW --- */}
        {lobbyInfo?.status === 'playing' && (
          <div className="flex flex-col lg:flex-row gap-8">
            <div className="flex-grow bg-slate-900 p-4 rounded-xl border border-slate-700 relative">
              {/* Board Grid Rendered Here */}
              <div className="grid grid-cols-12 gap-1 sm:gap-2">
                {BOARD_ROWS.map(r => BOARD_COLS.map(c => {
                  const id = `${c}${r}`;
                  const isP = lobbyInfo.board_state.includes(id);
                  const owner = lobbyInfo.tile_ownership[id];
                  return (
                    <div key={id} className={`w-8 h-8 sm:w-12 sm:h-12 flex items-center justify-center rounded text-[10px] font-bold border-2 ${isP ? (owner ? 'bg-slate-200 text-black border-white' : 'bg-amber-500 text-black') : 'bg-slate-800 text-slate-600 border-slate-700'}`}>
                      {id}
                    </div>
                  );
                }))}
              </div>
            </div>

            <div className="w-full lg:w-80 space-y-4">
               {/* END GAME CALLER */}
               {checkEndConditions() && players.find(p => p.play_order === lobbyInfo.current_turn_index)?.player_name === playerName && (
                 <div className="bg-amber-500/10 border-2 border-amber-500 p-4 rounded-lg text-center animate-bounce">
                    <p className="text-xs font-bold text-amber-500 mb-2 uppercase">Endgame Conditions Met!</p>
                    <button onClick={handleEndGame} className="w-full bg-amber-500 text-black font-black py-2 rounded shadow-lg">CALL END OF GAME</button>
                 </div>
               )}

               <div className="bg-slate-700 p-4 rounded-lg border border-slate-600">
                  <h3 className="font-bold mb-4 uppercase text-xs text-slate-400">Current Action</h3>
                  {players.find(p => p.play_order === lobbyInfo.current_turn_index)?.player_name === playerName ? (
                    <div className="space-y-2">
                      <p className="text-amber-400 font-bold">Your Turn</p>
                      {/* Place, Buy, End Turn Buttons */}
                    </div>
                  ) : <p className="text-slate-400">Waiting...</p>}
               </div>
            </div>
          </div>
        )}

        {/* Home/Lobby Setup (Existing Logic) */}
        {!lobbyInfo && (
          <div className="space-y-4">
            <input type="text" placeholder="Tycoon Name" value={playerName} onChange={e => setPlayerName(e.target.value)} className="w-full bg-slate-700 p-3 rounded" />
            <button onClick={() => setView('create')} className="w-full bg-amber-500 text-black font-bold py-3 rounded">CREATE GAME</button>
          </div>
        )}
      </div>
    </main>
  );
}