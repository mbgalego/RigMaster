import React, { useEffect, useRef, useState } from 'react';
import {
  initGame,
  getMainScene,
  getEditorScene,
  getGame,
  destroyGame,
} from './main';
import { MainScene, VehicleConfigType } from './scenes/MainScene';
import { LicenseSystem, LicenseInfo, ExamStatus, LicenseId } from './systems/LicenseSystem';
import { GarageSystem, HubData, WeatherModifier } from './systems/GarageSystem';
import { TimeOfDaySystem, TimePeriod } from './systems/TimeOfDaySystem';
import { WeatherSystem } from './systems/WeatherSystem';
import { TRAILER_TYPE_TO_LICENSE } from './systems/TrailerManager';
import type { TrailerType } from './entities/Trailer';
import type { RoadSurface, RoadGuardrailMode, RoadPointGuardrail } from './systems/RoadNetwork';
import type { AddObjectSpec } from './scenes/EditorScene';
import { compoundParts } from './world/WorldObjects';
import {
  TERRAIN_PAINT_CATALOG,
  type TerrainPaintMaterial,
  type TerrainPaintSoftness,
} from './world/WorldTerrain';
import { createCleanTruckDamage } from './systems/DamageSystem';
import { DEFAULT_TRUCK_UPGRADES, TRUCK_CATALOG, type UpgradeSlot } from './systems/TruckCatalog';
import {
  CERTIFICATE_CATALOG,
  createCleanTruckWear,
  ReputationSystem,
  type GameMode,
} from './systems/ReputationSystem';
import { MissionSystem } from './systems/MissionSystem';
import { SpriteRegistry } from './systems/SpriteRegistry';
import { TouchControls } from './components/TouchControls';
import { MissionsModal } from './components/MissionsModal';
import { FleetGarageModal } from './components/FleetGarageModal';
import { WorkshopUpgradesModal } from './components/WorkshopUpgradesModal';
import { WorldMapModal } from './components/WorldMapModal';
import { MissionEditorModal } from './components/MissionEditorModal';
import {
  RotateCcw,
  Volume2,
  VolumeX,
  Eye,
  AlertTriangle,
  Award,
  MapPin,
  Download,
  Upload,
  Play,
  Layers,
  Sparkles,
  Compass,
  CheckCircle,
  XCircle,
  FileCode,
  Smartphone,
  Menu,
  ChevronDown,
  Maximize,
  Minimize,
  Maximize2,
  X,
  Hand,
  ZoomIn,
  ZoomOut,
  Route,
  Box,
  Plus,
  Lamp,
  BrickWall,
  Warehouse,
  CarFront,
  DoorOpen,
  Building2,
  Factory,
  Circle,
  Equal,
  Mountain,
  Truck,
  Sun,
  Sunrise,
  Sunset,
  Moon,
  Clock,
  Watch,
  Container,
  Signpost,
  Fuel,
  Cog,
  Copy,
  CopyPlus,
  ClipboardPaste,
  Undo,
  OctagonAlert,
  Gauge,
  Ban,
  PersonStanding,
  Church,
  Home,
  Landmark,
  Wrench,
  Store,
  Wind,
  ClipboardList,
  Map as MapIcon,
  FlaskConical,
  TrendingUp,
  TrendingDown,
  Cloud,
  CloudRain,
  CloudLightning,
  CloudFog,
  Paintbrush,
  Eraser,
  Waves,
  Trash2,
  Building,
  Flame,
  Shield,
  Cross,
  GraduationCap,
  ShoppingCart,
  Anchor,
  Coffee,
  Sprout,
  Trees,
  Wheat,
  RefreshCw,
  ArrowUp,
  CornerUpRight,
  CornerUpLeft,
  ArrowDownRight,
  CircleMinus,
  CircleOff,
  Diamond,
  MoveUp,
  SquareParking,
  Spline,
  Construction,
} from 'lucide-react';

/** Catálogo do Criar, organizado por categorias — cada categoria tem o seu
 *  próprio botão na toolbar lateral, que abre um submenu a rolar para a direita. */
const CREATE_CATALOG: Array<{
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: Array<{ spec: AddObjectSpec; icon: React.ComponentType<{ className?: string }> }>;
}> = [
  {
    id: 'edif',
    label: 'Edifícios',
    icon: Building2,
    items: [
      { spec: { type: 'building', w: 900, h: 420, variant: 'warehouse_big', label: 'Armazém' }, icon: Warehouse },
      { spec: { type: 'building', w: 420, h: 360, variant: 'shed', label: 'Nave' }, icon: Factory },
      { spec: { type: 'building', w: 320, h: 220, variant: 'garage', label: 'Garagem' }, icon: Wrench },
      { spec: { type: 'building', w: 300, h: 200, variant: 'warehouse', label: 'Edifício' }, icon: Building2 },
      { spec: { type: 'building', w: 300, h: 200, variant: 'gabled', label: 'Telhado 2 Águas' }, icon: Home },
      { spec: { type: 'building', w: 220, h: 170, variant: 'church', label: 'Igreja' }, icon: Church },
      { spec: { type: 'building', w: 260, h: 160, variant: 'archway', label: 'Arco' }, icon: Landmark },
      { spec: { type: 'building', w: 240, h: 136, variant: 'convenience_store', label: 'Loja Conveniência' }, icon: Store },
      { spec: { type: 'building', w: 260, h: 150, variant: 'restaurant', label: 'Restaurante (A1)' }, icon: Store },
      { spec: { type: 'building', w: 900, h: 420, variant: 'warehouse_docks', params: { docks: 5 }, label: 'Armazém c/ Docas' }, icon: Warehouse },
      { spec: { type: 'building', w: 600, h: 300, variant: 'warehouse_docks', params: { docks: 3 }, label: 'Armazém 3 Docas' }, icon: Warehouse },
    ],
  },
  {
    id: 'cidade',
    label: 'Cidade',
    icon: Home,
    items: [
      { spec: { type: 'building', w: 150, h: 110, variant: 'house_traditional', label: 'Casa Tradicional' }, icon: Home },
      { spec: { type: 'building', w: 150, h: 110, variant: 'house_traditional', params: { garageAccess: true }, label: 'Casa c/ Garagem' }, icon: Home },
      { spec: { type: 'building', w: 240, h: 124, variant: 'house_townhouse', label: 'Casas Geminadas' }, icon: Home },
      { spec: { type: 'building', w: 182, h: 135, variant: 'house_urban_corner', label: 'Casa Citadina' }, icon: Home },
      { spec: { type: 'building', w: 182, h: 135, variant: 'house_urban_corner', params: { garageAccess: true }, label: 'Casa Citadina c/ Garagem' }, icon: Home },
      { spec: { type: 'building', w: 200, h: 150, variant: 'house_duplex', label: 'Moradia Urbana' }, icon: Home },
      { spec: { type: 'building', w: 200, h: 150, variant: 'house_duplex', params: { garageAccess: true }, label: 'Moradia Urbana c/ Garagem' }, icon: Home },
      { spec: { type: 'building', w: 210, h: 145, variant: 'villa_classic', label: 'Vivenda Tradicional' }, icon: Home },
      { spec: { type: 'building', w: 210, h: 145, variant: 'villa_classic', params: { garageAccess: true }, label: 'Vivenda Trad. c/ Garagem' }, icon: Home },
      { spec: { type: 'building', w: 200, h: 162, variant: 'villa_modern', label: 'Vivenda Moderna' }, icon: Home },
      { spec: { type: 'building', w: 200, h: 162, variant: 'villa_modern', params: { garageAccess: true }, label: 'Vivenda Mod. c/ Garagem' }, icon: Home },
      { spec: { type: 'building', w: 240, h: 200, variant: 'apartment_2f', label: 'Prédio 2 Andares' }, icon: Building },
      { spec: { type: 'building', w: 240, h: 200, variant: 'apartment_2f', params: { garageAccess: true }, label: 'Prédio 2 And. c/ Garagem' }, icon: Building },
      { spec: { type: 'building', w: 324, h: 220, variant: 'apartment_4f', label: 'Prédio 4 Andares' }, icon: Building },
      { spec: { type: 'building', w: 324, h: 220, variant: 'apartment_4f', params: { garageAccess: true, exteriorParking: true }, label: 'Prédio 4 And. Completo' }, icon: Building2 },
      { spec: { type: 'building', w: 246, h: 290, variant: 'apartment_10f', label: 'Torre 10 Andares' }, icon: Building2 },
      { spec: { type: 'building', w: 246, h: 290, variant: 'apartment_10f', params: { garageAccess: true, exteriorParking: true }, label: 'Torre 10 And. Completa' }, icon: Building2 },
      { spec: { type: 'building', w: 340, h: 166, variant: 'apartment_block', label: 'Prédio Residencial' }, icon: Building },
      { spec: { type: 'building', w: 340, h: 166, variant: 'apartment_block', params: { garageAccess: true }, label: 'Prédio c/ Garagem' }, icon: Building },
      { spec: { type: 'building', w: 340, h: 166, variant: 'apartment_block', params: { exteriorParking: true }, label: 'Prédio c/ Estacionamento' }, icon: CarFront },
      { spec: { type: 'building', w: 340, h: 166, variant: 'apartment_block', params: { garageAccess: true, exteriorParking: true }, label: 'Prédio Garagem + Estac.' }, icon: Building2 },
      { spec: { type: 'building', w: 320, h: 184, variant: 'apartment_modern', label: 'Prédio Moderno' }, icon: Building2 },
      { spec: { type: 'building', w: 320, h: 184, variant: 'apartment_modern', params: { garageAccess: true }, label: 'Prédio Mod. c/ Garagem' }, icon: Building2 },
      { spec: { type: 'building', w: 320, h: 184, variant: 'apartment_modern', params: { exteriorParking: true }, label: 'Prédio Mod. c/ Estac.' }, icon: CarFront },
      { spec: { type: 'building', w: 320, h: 184, variant: 'apartment_modern', params: { garageAccess: true, exteriorParking: true }, label: 'Prédio Mod. Completo' }, icon: Building2 },
    ],
  },
  {
    id: 'civico',
    label: 'Cívico',
    icon: Landmark,
    items: [
      { spec: { type: 'building', w: 330, h: 180, variant: 'fire_station', label: 'Bombeiros' }, icon: Flame },
      { spec: { type: 'building', w: 270, h: 190, variant: 'police_station', label: 'Polícia (PSP)' }, icon: Shield },
      { spec: { type: 'building', w: 360, h: 278, variant: 'hospital', label: 'Hospital' }, icon: Cross },
      { spec: { type: 'building', w: 360, h: 278, variant: 'hospital', params: { exteriorParking: true }, label: 'Hospital c/ Estacionamento' }, icon: Cross },
      { spec: { type: 'building', w: 320, h: 185, variant: 'school', label: 'Escola' }, icon: GraduationCap },
      { spec: { type: 'building', w: 360, h: 170, variant: 'supermarket', params: { exteriorParking: true }, label: 'Supermercado' }, icon: ShoppingCart },
      { spec: { type: 'building', w: 540, h: 328, variant: 'hypermarket', params: { exteriorParking: true }, label: 'Hipermercado' }, icon: ShoppingCart },
      { spec: { type: 'building', w: 250, h: 210, variant: 'town_hall', label: 'Câmara Municipal' }, icon: Landmark },
      { spec: { type: 'building', w: 230, h: 180, variant: 'esplanade', label: 'Esplanada' }, icon: Coffee },
      { spec: { type: 'building', w: 280, h: 280, variant: 'plaza_statue', label: 'Praça c/ Estátua' }, icon: Landmark },
      { spec: { type: 'building', w: 250, h: 254, variant: 'monument', label: 'Monumento' }, icon: Landmark },
      { spec: { type: 'building', w: 220, h: 170, variant: 'church', label: 'Igreja' }, icon: Church },
      { spec: { type: 'building', w: 260, h: 160, variant: 'archway', label: 'Arco Histórico' }, icon: Landmark },
    ],
  },
  {
    id: 'rural',
    label: 'Rural',
    icon: Sprout,
    items: [
      { spec: { type: 'building', w: 300, h: 218, variant: 'farmhouse', label: 'Quinta Tradicional' }, icon: Home },
      { spec: { type: 'building', w: 440, h: 220, variant: 'farm_pasture', label: 'Quinta c/ Animais' }, icon: Trees },
      { spec: { type: 'building', w: 496, h: 210, variant: 'farm_crops', label: 'Quinta c/ Plantações' }, icon: Sprout },
      { spec: { type: 'building', w: 432, h: 240, variant: 'crop_field', label: 'Campo de Plantações' }, icon: Sprout },
      { spec: { type: 'building', w: 434, h: 240, variant: 'crop_wheat', label: 'Campo de Cereal' }, icon: Wheat },
      { spec: { type: 'building', w: 500, h: 220, variant: 'sea_pier', label: 'Doca Marítima' }, icon: Anchor },
    ],
  },
  {
    id: 'docas',
    label: 'Docas',
    icon: Warehouse,
    items: [
      { spec: { type: 'dock', w: 128, h: 128, label: 'Doca' }, icon: Warehouse },
      { spec: { type: 'dock_wall', w: 420, h: 56, params: { docks: 3 }, label: 'Muro Docas' }, icon: BrickWall },
      { spec: { type: 'dock_wall', w: 700, h: 56, params: { docks: 6 }, label: 'Muro Docas ×6' }, icon: BrickWall },
      { spec: { type: 'building', w: 500, h: 220, variant: 'sea_pier', label: 'Doca Marítima' }, icon: Anchor },
    ],
  },
  {
    id: 'tr',
    label: 'Atrelados',
    icon: Truck,
    items: [
      { spec: { type: 'trailer', w: 46, h: 220, params: { trailer: 'standard' }, label: 'Standard (C)' }, icon: Truck },
      { spec: { type: 'trailer', w: 46, h: 220, params: { trailer: 'reefer' }, label: 'Frigorífico (C)' }, icon: Truck },
      { spec: { type: 'trailer', w: 46, h: 220, params: { trailer: 'container' }, label: 'Contentor 40ft (C)' }, icon: Container },
      { spec: { type: 'trailer', w: 46, h: 220, params: { trailer: 'tanker_milk' }, label: 'Cisterna Leite (C)' }, icon: Truck },
      { spec: { type: 'trailer', w: 46, h: 310, params: { trailer: 'long_cargo' }, label: 'Pá Eólica (C+E)' }, icon: Truck },
      { spec: { type: 'trailer', w: 48, h: 275, params: { trailer: 'flatbed_heavy' }, label: 'Prancha Escavadora (C+E)' }, icon: Truck },
      { spec: { type: 'trailer', w: 46, h: 255, params: { trailer: 'timber' }, label: 'Florestal Toros (C+E)' }, icon: Truck },
      { spec: { type: 'trailer', w: 46, h: 248, params: { trailer: 'tanker_fuel' }, label: 'Cisterna Petróleo (C+E)' }, icon: Fuel },
      { spec: { type: 'trailer', w: 46, h: 155, params: { trailer: 'bitrem_lead' }, label: 'Bitrem Frente (H)' }, icon: Truck },
      { spec: { type: 'trailer', w: 46, h: 155, params: { trailer: 'bitrem_pup' }, label: 'Bitrem Trás (H)' }, icon: Truck },
      { spec: { type: 'trailer', w: 46, h: 155, params: { trailer: 'bitrem_tanker_lead' }, label: 'Bitrem Cist. Fr. (H)' }, icon: Fuel },
      { spec: { type: 'trailer', w: 46, h: 155, params: { trailer: 'bitrem_tanker_pup' }, label: 'Bitrem Cist. Tr. (H)' }, icon: Fuel },
      { spec: { type: 'trailer', w: 46, h: 220, params: { trailer: 'fragile_glass' }, label: 'Vidro Óptico (X)' }, icon: Truck },
      { spec: { type: 'trailer', w: 46, h: 225, params: { trailer: 'tanker_hazmat' }, label: 'Cisterna ADR (X)' }, icon: AlertTriangle },
    ],
  },
  {
    id: 'pads',
    label: 'Pads',
    icon: CarFront,
    items: [
      { spec: { type: 'parking_pad', w: 130, h: 420, variant: 'asphalt', label: 'Baía Asfalto' }, icon: CarFront },
      { spec: { type: 'parking_pad', w: 130, h: 420, variant: 'concrete', label: 'Baía Betão' }, icon: Layers },
      { spec: { type: 'parking_pad', w: 140, h: 460, variant: 'hazard', label: 'Baía Segurança' }, icon: AlertTriangle },
      { spec: { type: 'parking_pad', w: 165, h: 640, variant: 'clean', label: 'Baía Longa' }, icon: CarFront },
    ],
  },
  {
    id: 'bases',
    label: 'Bases',
    icon: Mountain,
    items: [
      { spec: { type: 'pad_asphalt', w: 700, h: 420, label: 'Alcatrão' }, icon: Layers },
      { spec: { type: 'pad_dirt', w: 700, h: 420, label: 'Terra' }, icon: Mountain },
      { spec: { type: 'parking_lot', w: 520, h: 340, label: 'Parque' }, icon: CarFront },
    ],
  },
  {
    id: 'piso',
    label: 'Piso',
    icon: DoorOpen,
    items: [
      { spec: { type: 'road_entry', w: 140, h: 160, params: { lanes: 1 }, label: 'Entrada Estrada (1 Faixa)' }, icon: DoorOpen },
      { spec: { type: 'road_entry', w: 220, h: 180, params: { lanes: 2 }, label: 'Entrada Estrada (2 Faixas)' }, icon: Route },
      { spec: { type: 'road_entry', w: 240, h: 190, params: { lanes: 2, island: true }, label: 'Entrada Estrada c/ Ilha' }, icon: Route },
      { spec: { type: 'road_entry_y', w: 320, h: 240, params: { lanes: 1 }, label: 'Entrada Y (1 Faixa)' }, icon: Route },
      { spec: { type: 'road_entry_y', w: 420, h: 280, params: { lanes: 2 }, label: 'Entrada Y (2 Faixas)' }, icon: Route },
      { spec: { type: 'road_turnout', w: 440, h: 120, params: { layout: 'layby' }, label: 'Desvio Lateral (Baia)' }, icon: Route },
      { spec: { type: 'road_turnout', w: 520, h: 110, params: { layout: 'parallel' }, label: 'Estac. Paralelo (Berma)' }, icon: CarFront },
      { spec: { type: 'road_turnout', w: 480, h: 190, params: { layout: 'perpendicular' }, label: 'Estac. Perpendicular (90°)' }, icon: CarFront },
      { spec: { type: 'road_turnout', w: 500, h: 170, params: { layout: 'diagonal' }, label: 'Estac. Diagonal (45°)' }, icon: CarFront },
      { spec: { type: 'road_turnout', w: 620, h: 250, params: { layout: 'diagonal_truck' }, label: 'Estac. Diagonal Camiões' }, icon: Truck },
      { spec: { type: 'entrance', w: 140, h: 220, label: 'Entrada' }, icon: DoorOpen },
      { spec: { type: 'entrance_gas', w: 220, h: 300, params: { pumps: 1 }, label: 'Entrada Posto' }, icon: Fuel },
      { spec: { type: 'entrance_gas', w: 320, h: 300, params: { pumps: 2 }, label: 'Entrada Posto 2 Bombas' }, icon: Fuel },
      { spec: { type: 'crosswalk', w: 36, h: 170, label: 'Passadeira' }, icon: Equal },
    ],
  },
  {
    id: 'barreiras',
    label: 'Barreiras',
    icon: BrickWall,
    items: [
      { spec: { type: 'wall', w: 220, h: 26, label: 'Muro Betão' }, icon: BrickWall },
      { spec: { type: 'wall', w: 220, h: 26, variant: 'brick', label: 'Muro Tijolo' }, icon: BrickWall },
      { spec: { type: 'wall', w: 220, h: 28, variant: 'stone', label: 'Muro Pedra' }, icon: Mountain },
      { spec: { type: 'wall', w: 220, h: 26, variant: 'whitewash', label: 'Muro Caiado' }, icon: Landmark },
      { spec: { type: 'wall', w: 220, h: 24, variant: 'iron_fence', label: 'Muro c/ Grade' }, icon: Equal },
      { spec: { type: 'wall', w: 240, h: 24, variant: 'sound_barrier', label: 'Barreira Acústica' }, icon: Volume2 },
      { spec: { type: 'wall', w: 200, h: 28, variant: 'hedge', label: 'Sebe Viva' }, icon: Trees },
      { spec: { type: 'wall', w: 200, h: 18, variant: 'wood_fence', label: 'Vedação Madeira' }, icon: Equal },
      { spec: { type: 'wall', w: 220, h: 18, variant: 'chain_fence', label: 'Rede Metálica' }, icon: Shield },
      { spec: { type: 'jersey_barrier', w: 140, h: 26, label: 'New Jersey' }, icon: BrickWall },
      { spec: { type: 'jersey_barrier', w: 180, h: 16, variant: 'guardrail', label: 'Guarda Metálica' }, icon: Shield },
      { spec: { type: 'jersey_barrier', w: 150, h: 24, variant: 'water_red_white', label: 'Barreira Obra' }, icon: Construction },
      { spec: { type: 'jersey_barrier', w: 150, h: 24, variant: 'hazard_striped', label: 'Barreira Riscas' }, icon: AlertTriangle },
      { spec: { type: 'jersey_barrier', w: 140, h: 18, variant: 'bollards', label: 'Pilaretes' }, icon: Circle },
      { spec: { type: 'roundabout', w: 420, h: 420, label: 'Rotunda' }, icon: Circle },
    ],
  },
  {
    id: 'contentores',
    label: 'Contentores',
    icon: Container,
    items: [
      { spec: { type: 'container_stack', w: 110, h: 44, variant: 'blue', label: 'Azul' }, icon: Container },
      { spec: { type: 'container_stack', w: 110, h: 44, variant: 'red', label: 'Vermelho' }, icon: Container },
      { spec: { type: 'container_stack', w: 110, h: 44, variant: 'green', label: 'Verde' }, icon: Container },
      { spec: { type: 'container_stack', w: 110, h: 44, variant: 'rust', label: 'Ferrugem' }, icon: Container },
      { spec: { type: 'container_stack', w: 110, h: 44, variant: 'orange', label: 'Laranja' }, icon: Container },
      { spec: { type: 'container_stack', w: 110, h: 44, variant: 'yellow', label: 'Amarelo' }, icon: Container },
      { spec: { type: 'container_stack', w: 110, h: 44, variant: 'white', label: 'Branco' }, icon: Container },
      { spec: { type: 'container_stack', w: 180, h: 150, variant: 'blue', label: 'Pilha Azul' }, icon: Box },
      { spec: { type: 'container_stack', w: 180, h: 150, variant: 'red', label: 'Pilha Vermelha' }, icon: Box },
      { spec: { type: 'container_stack', w: 180, h: 150, variant: 'rust', label: 'Pilha Ferrugem' }, icon: Box },
    ],
  },
  {
    id: 'transito',
    label: 'Trânsito',
    icon: Signpost,
    items: [
      { spec: { type: 'sign', w: 22, h: 22, variant: 'stop', label: 'STOP' }, icon: OctagonAlert },
      { spec: { type: 'sign', w: 22, h: 22, variant: 'yield', label: 'Cedência' }, icon: AlertTriangle },
      { spec: { type: 'sign', w: 22, h: 22, variant: 'priority_road', label: 'Via c/ Prioridade' }, icon: Diamond },
      { spec: { type: 'sign', w: 22, h: 22, variant: 'roundabout', label: 'Rotunda' }, icon: RefreshCw },
      { spec: { type: 'sign', w: 22, h: 22, variant: 'mandatory_straight', label: 'Sentido Obrigatório' }, icon: ArrowUp },
      { spec: { type: 'sign', w: 22, h: 22, variant: 'mandatory_right', label: 'Obrigatório Direita' }, icon: CornerUpRight },
      { spec: { type: 'sign', w: 22, h: 22, variant: 'mandatory_left', label: 'Obrigatório Esquerda' }, icon: CornerUpLeft },
      { spec: { type: 'sign', w: 22, h: 22, variant: 'keep_right', label: 'Contornar Direita' }, icon: ArrowDownRight },
      { spec: { type: 'sign', w: 22, h: 22, variant: 'one_way', label: 'Sentido Único' }, icon: MoveUp },
      { spec: { type: 'sign', w: 22, h: 22, variant: 'no_entry', label: 'Sentido Proibido' }, icon: CircleMinus },
      { spec: { type: 'sign', w: 22, h: 22, variant: 'no_trucks', label: 'Proibido Pesados' }, icon: CircleOff },
      { spec: { type: 'sign', w: 22, h: 22, variant: 'no_parking', label: 'Proibido Estacionar' }, icon: Ban },
      { spec: { type: 'sign', w: 22, h: 22, variant: 'speed_30', label: 'Limite 30' }, icon: Gauge },
      { spec: { type: 'sign', w: 22, h: 22, variant: 'speed', label: 'Limite 50' }, icon: Gauge },
      { spec: { type: 'sign', w: 22, h: 22, variant: 'speed_80', label: 'Limite 80' }, icon: Gauge },
      { spec: { type: 'sign', w: 22, h: 22, variant: 'speed_120', label: 'Limite 120' }, icon: Gauge },
      { spec: { type: 'sign', w: 22, h: 22, variant: 'parking', label: 'Estacionamento' }, icon: SquareParking },
      { spec: { type: 'sign', w: 22, h: 22, variant: 'pedestrian', label: 'Peões' }, icon: PersonStanding },
      { spec: { type: 'sign', w: 28, h: 28, variant: 'danger_roundabout', label: 'Aprox. Rotunda' }, icon: RefreshCw },
      { spec: { type: 'sign', w: 28, h: 28, variant: 'danger_curve', label: 'Curva Perigosa' }, icon: Spline },
      { spec: { type: 'sign', w: 28, h: 28, variant: 'danger_work', label: 'Obras na Via' }, icon: Construction },
      { spec: { type: 'sign', w: 36, h: 36, variant: 'steep_uphill', label: 'Subida Acentuada' }, icon: TrendingUp },
      { spec: { type: 'sign', w: 36, h: 36, variant: 'steep_downhill', label: 'Descida Acentuada' }, icon: TrendingDown },
      { spec: { type: 'traffic_light', w: 22, h: 22, params: { dir: 'n', group: 0 }, label: 'Semáforo' }, icon: Lamp },
      { spec: { type: 'lamp', w: 14, h: 14, label: 'Candeeiro' }, icon: Lamp },
    ],
  },
  {
    id: 'industrial',
    label: 'Industrial',
    icon: Cog,
    items: [
      { spec: { type: 'crane', w: 110, h: 280, label: 'Guindaste' }, icon: Cog },
      { spec: { type: 'silo', w: 128, h: 128, label: 'Silo' }, icon: Cog },
    ],
  },
  {
    id: 'servicos',
    label: 'Serviços',
    icon: Fuel,
    items: [
      { spec: { type: 'hub_sign', w: 68, h: 68, label: 'Sinal de HUB' }, icon: MapPin },
      { spec: { type: 'gas_pump', w: 48, h: 116, label: 'Bomba Combustível' }, icon: Fuel },
      {
        spec: {
          type: 'gas_canopy',
          w: 640,
          h: 860,
          params: { stationStyle: 'highway', accessSide: 'right' },
          label: 'Posto AE (Estrada Dir.)',
        },
        icon: Layers,
      },
      {
        spec: {
          type: 'gas_canopy',
          w: 640,
          h: 860,
          params: { stationStyle: 'highway', accessSide: 'left' },
          label: 'Posto AE (Estrada Esq.)',
        },
        icon: Layers,
      },
      {
        spec: {
          type: 'gas_canopy',
          w: 860,
          h: 640,
          params: { stationStyle: 'highway', accessSide: 'top' },
          label: 'Posto AE (Estrada Cima)',
        },
        icon: Layers,
      },
      {
        spec: {
          type: 'gas_canopy',
          w: 860,
          h: 640,
          params: { stationStyle: 'highway', accessSide: 'bottom' },
          label: 'Posto AE (Estrada Baixo)',
        },
        icon: Layers,
      },
      {
        spec: {
          type: 'gas_canopy',
          w: 480,
          h: 740,
          params: { stationStyle: 'highway', accessSide: 'through' },
          label: 'Posto AE (Passante)',
        },
        icon: Layers,
      },
      {
        spec: {
          type: 'gas_canopy',
          w: 380,
          h: 520,
          params: { stationStyle: 'secondary', accessSide: 'right' },
          label: 'Posto 1B (Estrada Dir.)',
        },
        icon: Layers,
      },
      {
        spec: {
          type: 'gas_canopy',
          w: 380,
          h: 520,
          params: { stationStyle: 'secondary', accessSide: 'left' },
          label: 'Posto 1B (Estrada Esq.)',
        },
        icon: Layers,
      },
      {
        spec: {
          type: 'gas_canopy',
          w: 520,
          h: 380,
          params: { stationStyle: 'secondary', accessSide: 'top' },
          label: 'Posto 1B (Estrada Cima)',
        },
        icon: Layers,
      },
      {
        spec: {
          type: 'gas_canopy',
          w: 520,
          h: 380,
          params: { stationStyle: 'secondary', accessSide: 'bottom' },
          label: 'Posto 1B (Estrada Baixo)',
        },
        icon: Layers,
      },
      {
        spec: {
          type: 'gas_canopy',
          w: 270,
          h: 480,
          params: { stationStyle: 'secondary', accessSide: 'through' },
          label: 'Posto 1B (Passante)',
        },
        icon: Layers,
      },
      { spec: { type: 'building', w: 128, h: 84, variant: 'fuel_kiosk', label: 'Casa Apoio Posto' }, icon: Store },
      { spec: { type: 'building', w: 240, h: 136, variant: 'convenience_store', label: 'Loja Conveniência' }, icon: Store },
      { spec: { type: 'building', w: 260, h: 150, variant: 'restaurant', label: 'Restaurante (A1)' }, icon: Store },
      { spec: { type: 'air_water', w: 84, h: 42, label: 'Ar / Água / Aspirador' }, icon: Wind },
      { spec: { type: 'price_sign', w: 56, h: 120, label: 'Totem Preços' }, icon: Gauge },
    ],
  },
  {
    id: 'serra',
    label: 'Serra',
    icon: Mountain,
    items: [
      { spec: { type: 'wind_turbine', w: 120, h: 120, label: 'Torre Eólica' }, icon: Wind },
      { spec: { type: 'log_pile', w: 170, h: 64, label: 'Pilha de Toros' }, icon: Layers },
      { spec: { type: 'rock_outcrop', w: 96, h: 84, label: 'Afloramento Rochoso' }, icon: Mountain },
      { spec: { type: 'pine_tree', w: 72, h: 72, label: 'Pinheiro Alpino' }, icon: Mountain },
    ],
  },
];

/** Ícone de período do dia usado pelo relógio 24h do HUD superior. */
const PERIOD_ICONS: Record<TimePeriod, React.ComponentType<{ className?: string }>> = {
  dawn: Sunrise,
  day: Sun,
  dusk: Sunset,
  night: Moon,
};

export default function App() {
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const [isEditorMode, setIsEditorMode] = useState<boolean>(false);
  const [vehicleConfig, setVehicleConfig] = useState<VehicleConfigType>('solo');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [debugWireframe, setDebugWireframe] = useState<boolean>(false);
  const [showTouchControls, setShowTouchControls] = useState<boolean>(true);
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [cameraZoom, setCameraZoom] = useState<number>(1.0);
  const lastZoomRef = useRef<number>(1.0);

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Modals & Panels
  const [showLicenseModal, setShowLicenseModal] = useState<boolean>(false);
  const [showGarageModal, setShowGarageModal] = useState<boolean>(false);
  const [showMissionsModal, setShowMissionsModal] = useState<boolean>(false);
  const [showMissionEditorModal, setShowMissionEditorModal] = useState<boolean>(false);
  const [missionEditorHubId, setMissionEditorHubId] = useState<string | null>(null);
  const [customMissionCount, setCustomMissionCount] = useState<number>(0);
  const [showFleetModal, setShowFleetModal] = useState<boolean>(false);
  const [showWorkshopModal, setShowWorkshopModal] = useState<boolean>(false);
  const [showWorldMapModal, setShowWorldMapModal] = useState<boolean>(false);
  const [mapFocusTruckId, setMapFocusTruckId] = useState<string | null>(null);
  const [showJsonModal, setShowJsonModal] = useState<boolean>(false);
  const [jsonContent, setJsonContent] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // System states
  const [licenses, setLicenses] = useState<LicenseInfo[]>([]);
  const [hubs, setHubs] = useState<HubData[]>([]);
  const [activeWeather, setActiveWeather] = useState<WeatherModifier>('clear');
  const [weatherDynamic, setWeatherDynamic] = useState<boolean>(() => WeatherSystem.getInstance().isDynamicEnabled());
  const [editorTool, setEditorTool] = useState<'pan' | 'road' | 'terrain' | 'object' | 'spawn' | 'add' | 'compound'>('pan');
  const editorToolRef = useRef<'pan' | 'road' | 'terrain' | 'object' | 'spawn' | 'add' | 'compound'>('pan');
  // Catalog selection for the 'add' (Criar) tool
  const [addType, setAddType] = useState<AddObjectSpec>({ type: 'wall', w: 220, h: 26, label: 'Muro' });
  const [addCat, setAddCat] = useState<string>('barreiras');

  // Terrain brush tool live state (polled from EditorScene)
  const [terrainUI, setTerrainUI] = useState<{
    material: TerrainPaintMaterial;
    mode: 'paint' | 'erase';
    radius: number;
    softness: TerrainPaintSoftness;
    clipWater: boolean;
    strokeCount: number;
  }>({
    material: 'concrete',
    mode: 'paint',
    radius: 96,
    softness: 'soft',
    clipWater: true,
    strokeCount: 0,
  });

  // Road tool live state (polled from EditorScene in the telemetry loop)
  const [roadUI, setRoadUI] = useState<{
    hasSelection: boolean;
    hasPoint: boolean;
    surface: RoadSurface;
    width: number;
    drawing: boolean;
    twistDeg: number;
    oneWay: boolean;
    layer: number;
    guardrail: RoadGuardrailMode;
    pointGuardrail: RoadPointGuardrail;
    tooShort: boolean;
    snapToRoads: boolean;
    isolateSelectedRoad: boolean;
    overlapCount: number;
    overlapIndex: number;
    canWeld: boolean;
    canMerge: boolean;
  }>({
    hasSelection: false,
    hasPoint: false,
    surface: 'asphalt',
    width: 128,
    drawing: false,
    twistDeg: 0,
    oneWay: false,
    layer: 0,
    guardrail: 'none',
    pointGuardrail: 'auto',
    tooShort: false,
    snapToRoads: true,
    isolateSelectedRoad: false,
    overlapCount: 0,
    overlapIndex: 0,
    canWeld: false,
    canMerge: false,
  });
  // Object tool live state (polled from EditorScene in the telemetry loop)
  const [objectUI, setObjectUI] = useState<{
    hasSelection: boolean;
    id: string;
    type: string;
    variant: string;
    angleDeg: number;
    resizable: boolean;
    trailer: string;
    canPaste: boolean;
    rotationSnap: boolean;
    canUndo: boolean;
    isCompound: boolean;
    compoundPartCount: number;
    hubSign: {
      hubId: string;
      name: string;
      badge: string;
      color: string;
      regionRadius: number;
      isCustom: boolean;
      docks: number;
      parkingPads: number;
      garages: number;
    } | null;
    gasCanopy: {
      stationStyle: 'highway' | 'secondary';
      accessSide: 'right' | 'left' | 'top' | 'bottom' | 'through';
    } | null;
    buildingFeatures: {
      supportsGarage: boolean;
      supportsParking: boolean;
      garageAccess: boolean;
      exteriorParking: boolean;
    } | null;
  }>({
    hasSelection: false,
    id: '',
    type: '',
    variant: '',
    angleDeg: 0,
    resizable: false,
    trailer: '',
    canPaste: false,
    rotationSnap: true,
    canUndo: false,
    isCompound: false,
    compoundPartCount: 0,
    hubSign: null,
    gasCanopy: null,
    buildingFeatures: null,
  });

  // Real-time Telemetry
  const [telemetry, setTelemetry] = useState<MainScene['telemetry']>({
    speedKmh: 0,
    steeringDeg: 0,
    articulationDeg: 0,
    isJackknifed: false,
    isMechanicalLocked: false,
    jackknifeSeverity: 0,
    tailSwingPx: 0,
    offTrackingPx: 0,
    isReversing: false,
    collisions: 0,
    fragileHealth: 100,
    truckHealth: 100,
    truckDamage: createCleanTruckDamage(),
    trailerHealth: 100,
    cargoHealth: 100,
    currentGForce: 0,
    peakGForce: 0,
    weather: 'clear',
    weatherDynamic: true,
    weatherCondition: 'clear',
    rainIntensity: 0,
    stormIntensity: 0,
    fogDensity: 0,
    cloudCover: 0.22,
    roadWetness: 0,
    headlightMode: 'off',
    autoHeadlights: true,
    timePeriod: 'day',
    timeClock: '09:07',
    autoTimeCycle: true,
    timeRealTime: false,
    activeLicenseExam: null,
    fuelLevel: 500,
    fuelCapacity: 500,
    fuelPercent: 100,
    isOutOfFuel: false,
    isRefuelling: false,
    isRepairing: false,
    fuelPrice: 1.749,
    nearbyPump: null,
    nearbyRepairBay: null,
    gameMode: 'career',
    activeTruckId: 'iveco_daily_4x2',
    activeTruckType: 'iveco_daily_4x2',
    activeTruckName: 'Iveco Daily 4×2',
    activeTruckUpgrades: { ...DEFAULT_TRUCK_UPGRADES },
    truckWear: createCleanTruckWear(),
    brakeHeat: 0,
    altitudeM: 0,
    gradePercent: 0,
    nearbySwapTruck: null,
    currentHubId: 'harbor',
    hubReputation: { harbor: 0, shipyard: 0, industrial: 0, historic: 0, serra: 0 },
    activeMission: null,
    missionNavTarget: null,
    lastMissionCompletion: null,
    coupling: { decoupleReady: false, coupledName: null, blocked: null, notice: null, noticeKind: 'info', noticeSeq: 0, noticeDurationMs: 3500 },
  });

  // Toast notifications (coupling feedback) — triggered by noticeSeq changes
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; kind: string }>>([]);
  const toastIdRef = useRef(0);
  const noticeSeq = telemetry.coupling?.noticeSeq ?? 0;

  // Track previous warning states to detect transitions (edge-triggered toasts)
  const prevOutOfFuel = useRef(telemetry.isOutOfFuel);
  const prevNearbyPump = useRef(telemetry.nearbyPump);
  const prevNearbyRepairBay = useRef(telemetry.nearbyRepairBay);
  const prevJackknifed = useRef(telemetry.isJackknifed);
  const prevCargoHealth = useRef(telemetry.cargoHealth);
  const prevEngineHealth = useRef(telemetry.truckDamage.engine);

  const toastTimersRef = useRef<Set<number>>(new Set());

  const addToast = (text: string, kind: 'info' | 'success' | 'blocked' | 'fuel' = 'info', durationMs = 3000) => {
    const id = ++toastIdRef.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    const timerId = window.setTimeout(() => {
      toastTimersRef.current.delete(timerId);
      setToasts((t) => t.filter((x) => x.id !== id));
    }, durationMs);
    toastTimersRef.current.add(timerId);
  };

  // Out of fuel → toast (engine shutoff)
  useEffect(() => {
    if (!prevOutOfFuel.current && telemetry.isOutOfFuel) {
      addToast('Sem combustível — motor desligado', 'fuel', 4500);
    }
    prevOutOfFuel.current = telemetry.isOutOfFuel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telemetry.isOutOfFuel]);

  // Nearby pump → toast (only when entering range)
  useEffect(() => {
    if (!prevNearbyPump.current && telemetry.nearbyPump) {
      addToast('Bomba por perto — toque ou F para abastecer', 'info');
    }
    prevNearbyPump.current = telemetry.nearbyPump;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telemetry.nearbyPump]);

  // Nearby garage repair bay → toast (only when damaged and entering bay)
  useEffect(() => {
    if (
      !prevNearbyRepairBay.current &&
      telemetry.nearbyRepairBay &&
      (telemetry.truckHealth < 100 || telemetry.trailerHealth < 100)
    ) {
      addToast('Oficina por perto — toque ou E para reparar', 'info');
    }
    prevNearbyRepairBay.current = telemetry.nearbyRepairBay;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telemetry.nearbyRepairBay, telemetry.truckHealth, telemetry.trailerHealth]);

  // Jackknife → toast
  useEffect(() => {
    if (!prevJackknifed.current && telemetry.isJackknifed) {
      addToast('JACKKNIFE — corrija a articulação', 'blocked');
    }
    prevJackknifed.current = telemetry.isJackknifed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telemetry.isJackknifed]);

  // Engine damage / limp mode warnings → toast
  useEffect(() => {
    const engine = telemetry.truckDamage?.engine ?? 100;
    if (prevEngineHealth.current > 15 && engine <= 15) {
      addToast('Motor em modo de emergência — repare numa garagem', 'fuel', 4200);
    } else if (prevEngineHealth.current > 40 && engine <= 40) {
      addToast(`Motor danificado (${engine}%) — procure uma garagem`, 'blocked', 3600);
    }
    prevEngineHealth.current = engine;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telemetry.truckDamage?.engine]);

  // Cargo health warning → toast
  useEffect(() => {
    if (prevCargoHealth.current > telemetry.cargoHealth && telemetry.cargoHealth <= 50) {
      addToast(`Carga danificada: ${telemetry.cargoHealth}%`, 'blocked');
    }
    prevCargoHealth.current = telemetry.cargoHealth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telemetry.cargoHealth]);

  useEffect(() => {
    const n = telemetry.coupling?.notice;
    if (!n) return;
    const kind = telemetry.coupling?.noticeKind ?? 'info';
    const durationMs = telemetry.coupling?.noticeDurationMs ?? 3500;
    addToast(n, kind, durationMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noticeSeq]);

  const [activeExam, setActiveExam] = useState<ExamStatus | null>(null);

  // When any modal/overlay is open, the Phaser canvas must not capture pointer events,
  // otherwise clicks/taps on HTML buttons (e.g. "Continuar" do exame) are swallowed by the game.
  const modalOpen = Boolean(
    showLicenseModal ||
      showGarageModal ||
      showMissionsModal ||
      showMissionEditorModal ||
      showFleetModal ||
      showWorkshopModal ||
      showWorldMapModal ||
      showJsonModal ||
      telemetry.lastMissionCompletion ||
      (activeExam && (activeExam.active || activeExam.isPassed || activeExam.isFailed))
  );

  // Global keyboard shortcuts: M toggles World Map (in drive mode), Escape closes active modals
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === 'Escape') {
        setShowMissionsModal(false);
        setShowMissionEditorModal(false);
        setShowFleetModal(false);
        setShowWorkshopModal(false);
        setShowWorldMapModal(false);
        setShowLicenseModal(false);
        setShowGarageModal(false);
        setShowJsonModal(false);
        setIsMenuOpen(false);
      } else if ((e.key === 'm' || e.key === 'M') && !isEditorMode) {
        e.preventDefault();
        setMapFocusTruckId(null);
        setShowWorldMapModal((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isEditorMode]);

  // Initialize Phaser
  useEffect(() => {
    if (!gameContainerRef.current) return;

    const game = initGame(gameContainerRef.current);
    const licSys = LicenseSystem.getInstance();
    const garSys = GarageSystem.getInstance();

    setLicenses(licSys.getLicenses());
    setHubs(garSys.getHubs());
    setActiveWeather(garSys.getActiveModifier());

    const unsubLic = licSys.subscribe(() => {
      setLicenses(licSys.getLicenses());
      setActiveExam(licSys.getActiveExam());
    });

    const unsubGar = garSys.subscribe(() => {
      setHubs(garSys.getHubs());
      setActiveWeather(garSys.getActiveModifier());
    });

    const misSys = MissionSystem.getInstance();
    setCustomMissionCount(misSys.getCustomMissions().length);
    const unsubMis = misSys.subscribe(() => {
      setCustomMissionCount(misSys.getCustomMissions().length);
    });

    const weatherSys = WeatherSystem.getInstance();
    setWeatherDynamic(weatherSys.isDynamicEnabled());
    const unsubWeather = weatherSys.subscribe(() => {
      setWeatherDynamic(weatherSys.isDynamicEnabled());
    });

    // Telemetry polling loop from MainScene
    let lastTelKey = '';
    let lastEditorFlag: boolean | null = null;
    let lastExamKey = '';
    let lastRoadUIKey = '';
    let lastObjUIKey = '';
    let lastTerrainUIKey = '';
    const interval = setInterval(() => {
      const scene = getMainScene();
      const edScene = getEditorScene();
      if (scene) {
        if (scene.world?.restoredFromDraft) {
          scene.world.restoredFromDraft = false;
          addToast('Mapa restaurado a partir do browser storage', 'success', 4000);
        }
        const t = scene.telemetry;
        const am = t.activeMission;
        const nav = t.missionNavTarget;
        const lmc = t.lastMissionCompletion;
        const telKey =
          `${t.speedKmh}|${t.isReversing ? 1 : 0}|${t.truckHealth}|${t.trailerHealth}|${t.cargoHealth}|` +
          `${t.truckDamage.engine},${t.truckDamage.steering},${t.truckDamage.chassis},${t.truckDamage.lights},${Math.round(t.truckDamage.leftLight)},${Math.round(t.truckDamage.rightLight)},` +
          `${Math.round(t.truckDamage.rearLights.brakeLeft)},${Math.round(t.truckDamage.rearLights.brakeRight)},${Math.round(t.truckDamage.rearLights.reverseLeft)},${Math.round(t.truckDamage.rearLights.reverseRight)}|` +
          `${Math.round(t.fuelPercent * 10)}|${Math.round(t.fuelLevel * 10)}|${t.isOutOfFuel ? 1 : 0}|` +
          `${t.isRefuelling ? 1 : 0}|${t.isRepairing ? 1 : 0}|${t.isJackknifed ? 1 : 0}|${t.isMechanicalLocked ? 1 : 0}|` +
          `${t.articulationDeg}|${t.collisions}|${t.weather}|${t.weatherDynamic ? 1 : 0},${t.weatherCondition},${Math.round(t.rainIntensity * 10)},${Math.round(t.stormIntensity * 10)},${Math.round(t.fogDensity * 10)}|${t.currentGForce.toFixed(2)}|${t.peakGForce.toFixed(2)}|` +
          `${t.headlightMode}|${t.autoHeadlights ? 1 : 0}|${t.timePeriod}|${t.timeClock}|${t.autoTimeCycle ? 1 : 0}|${t.timeRealTime ? 1 : 0}|` +
          `${t.nearbyPump ? `${t.nearbyPump.x},${t.nearbyPump.y}` : ''}|` +
          `${t.nearbyRepairBay ? `${t.nearbyRepairBay.x},${t.nearbyRepairBay.y}` : ''}|` +
          `${t.gameMode}|${t.activeTruckId}|${t.activeTruckUpgrades.engine},${t.activeTruckUpgrades.brakes},${t.activeTruckUpgrades.suspension},${t.activeTruckUpgrades.tires}|` +
          `${Math.round(t.truckWear.engine)},${Math.round(t.truckWear.brakes)},${Math.round(t.truckWear.tires)}|${Math.round(t.brakeHeat * 20)}|${Math.round(t.altitudeM / 5)},${Math.round(t.gradePercent)}|` +
          `${t.nearbySwapTruck ? `${t.nearbySwapTruck.id}:${Math.round(t.nearbySwapTruck.dist)}` : ''}|${t.currentHubId}|` +
          `${Object.entries(t.hubReputation).map(([k, v]) => `${k}:${v}`).join(',')}|` +
          `${am ? `${am.mission.id}:${am.phase}:${Math.floor(am.elapsedSec)}:${am.collisions}:${Math.round(am.minCargoHealth)}:${am.inTargetDock ? 1 : 0}:${am.dockHoldSec.toFixed(1)}` : ''}|` +
          `${nav ? `${nav.phase}:${Math.round(nav.distPx / 100)}:${nav.pickupHubName}:${nav.hasWrongTrailerCoupled ? 1 : 0}:${nav.needsPupOnly ? 1 : 0}` : ''}|` +
          `${lmc ? lmc.completedAt : ''}|` +
          `${t.coupling.noticeSeq}|${t.coupling.decoupleReady ? 1 : 0}|${t.coupling.coupledName ?? ''}|${t.coupling.blocked ?? ''}`;
        if (telKey !== lastTelKey) {
          lastTelKey = telKey;
          setTelemetry({ ...t });
        }
        if (scene.isEditorMode !== lastEditorFlag) {
          lastEditorFlag = scene.isEditorMode;
          setIsEditorMode(scene.isEditorMode);
        }
        const ex = licSys.getActiveExam();
        const examKey =
          ex.active || ex.isPassed || ex.isFailed
            ? `${ex.active}|${ex.isPassed}|${ex.isFailed}|${Math.ceil(ex.remainingTime)}|${ex.collisionCount}|${ex.inDockZone}|${Math.round(ex.dockAlignmentDeg)}|${ex.dockHoldSec.toFixed(1)}|${ex.jackknifeSec.toFixed(1)}|${ex.currentGForce.toFixed(2)}|${ex.peakGForce.toFixed(2)}|${ex.reversedDuringExam ? 1 : 0}`
            : 'idle';
        if (examKey !== lastExamKey) {
          lastExamKey = examKey;
          setActiveExam(ex);
        }
        const activeZoom =
          (scene.isEditorMode ? edScene?.cameras?.main?.zoom : scene.cameras?.main?.zoom) ?? 1;
        const roundedZoom = Math.round(activeZoom * 100) / 100;
        if (Math.abs(roundedZoom - lastZoomRef.current) >= 0.01) {
          lastZoomRef.current = roundedZoom;
          setCameraZoom(roundedZoom);
        }
      }
      if (edScene && scene?.isEditorMode) {
        const nextRoad = edScene.getRoadUIState();
        const roadKey = JSON.stringify(nextRoad);
        if (roadKey !== lastRoadUIKey) {
          lastRoadUIKey = roadKey;
          setRoadUI(nextRoad);
        }
        const nextObj = edScene.getObjectUIState();
        const objKey = JSON.stringify(nextObj);
        if (objKey !== lastObjUIKey) {
          lastObjUIKey = objKey;
          setObjectUI(nextObj);
        }
        const nextTerrain = edScene.getTerrainUIState();
        const terrainKey = JSON.stringify(nextTerrain);
        if (terrainKey !== lastTerrainUIKey) {
          lastTerrainUIKey = terrainKey;
          setTerrainUI(nextTerrain);
        }
        // The scene can switch tools by itself (e.g. Criar → Objectos after placing)
        if (edScene.editorTool !== editorToolRef.current) {
          editorToolRef.current = edScene.editorTool;
          setEditorTool(edScene.editorTool);
        }
      }
    }, 100);

    return () => {
      clearInterval(interval);
      for (const timerId of toastTimersRef.current) {
        window.clearTimeout(timerId);
      }
      toastTimersRef.current.clear();
      unsubLic();
      unsubGar();
      unsubMis();
      unsubWeather();
      destroyGame();
    };
  }, []);

  // Keep the Phaser canvas & keyboard plugins from stealing pointer or keyboard events
  // while any HTML modal is open or any text/select input has focus.
  useEffect(() => {
    const isDomInput = (el: Element | null): boolean =>
      el instanceof HTMLElement &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable);

    const applyIsolation = () => {
      const game = getGame();
      const canvas = game?.canvas as HTMLCanvasElement | undefined;
      if (canvas) {
        canvas.style.pointerEvents = modalOpen ? 'none' : 'auto';
      }
      const blockKeyboard = modalOpen || isDomInput(document.activeElement);
      const scenes = [getMainScene(), getEditorScene()];
      for (const sc of scenes) {
        const kb = sc?.input?.keyboard;
        if (!kb) continue;
        kb.enabled = !blockKeyboard;
        if (blockKeyboard) {
          kb.resetKeys();
          kb.disableGlobalCapture();
        } else {
          kb.enableGlobalCapture();
        }
      }
    };

    applyIsolation();
    const onFocusChange = () => applyIsolation();
    document.addEventListener('focusin', onFocusChange, true);
    document.addEventListener('focusout', onFocusChange, true);
    return () => {
      document.removeEventListener('focusin', onFocusChange, true);
      document.removeEventListener('focusout', onFocusChange, true);
    };
  }, [modalOpen, isEditorMode]);

  // Mode Switch
  const handleToggleMode = () => {
    const scene = getMainScene();
    if (scene) {
      scene.toggleEditorMode();
      setIsEditorMode(scene.isEditorMode);
    }
  };

  const getRequiredLicenseForConfig = (type: VehicleConfigType): LicenseId => {
    if (type === 'solo') return 'C';
    if (type === 'bitrem' || type === 'bitrem_tanker') return 'H';
    return TRAILER_TYPE_TO_LICENSE[type as TrailerType] ?? 'C';
  };

  // Change Vehicle Rig
  // `force` bypasses license & active-exam gates — used exclusively when an exam assigns its own vehicle.
  const handleSelectVehicle = (type: VehicleConfigType, force: boolean = false) => {
    const licSys = LicenseSystem.getInstance();
    const exam = licSys.getActiveExam();

    // Never allow manual vehicle swaps (or free repairs by re-selecting) during an active exam
    if (!force && exam.active) {
      addToast('Não pode trocar de veículo durante um exame ativo', 'blocked');
      return;
    }

    // H3 (Option A): Direct trailer/rig spawning from Menu is exclusive to Sandbox mode.
    // In Career mode, trailers are coupled physically in parks or via accepted missions.
    if (!force && !ReputationSystem.getInstance().isSandbox()) {
      addToast('Seleção direta de atrelado disponível apenas no modo Sandbox — acople fisicamente nos parques ou missões', 'blocked');
      return;
    }

    // Check license requirement
    if (!force) {
      const reqLic = getRequiredLicenseForConfig(type);
      if (reqLic !== 'C' && !licSys.isUnlocked(reqLic)) {
        setShowLicenseModal(true);
        return;
      }
    }

    setVehicleConfig(type);
    const scene = getMainScene();
    if (scene) {
      scene.spawnVehicleRig(type, { repair: force });
    }
  };

  // Reset Truck
  const handleReset = (allowDuringExam: boolean = false) => {
    const scene = getMainScene();
    if (scene) scene.resetVehicleToSpawn(allowDuringExam);
  };

  // Toggle Wireframe Debug
  const handleToggleDebug = () => {
    const scene = getMainScene();
    if (scene) {
      scene.togglePhysicsDebug();
      setDebugWireframe(scene.debugMatter);
    }
  };

  // Sound Toggle
  const handleToggleSound = () => {
    const scene = getMainScene();
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (scene) scene.setSoundEnabled(next);
  };

  // Full Screen Toggle
  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Weather Modifier (gated by hub dominance; locked to rain during Exam X)
  const handleSetWeather = (weather: WeatherModifier) => {
    const exam = LicenseSystem.getInstance().getActiveExam();
    if (exam.active && exam.licenseId === 'X') {
      addToast('Clima fixo em chuva durante o Exame X', 'blocked');
      return;
    }
    const garSys = GarageSystem.getInstance();
    if (!garSys.getUnlockedModifiers().includes(weather)) return;
    if (weather === 'clear') {
      WeatherSystem.getInstance().setDynamicEnabled(false);
    }
    garSys.setActiveModifier(weather);
  };

  const handleSetDynamicWeather = () => {
    const exam = LicenseSystem.getInstance().getActiveExam();
    if (exam.active && exam.licenseId === 'X') {
      addToast('Clima fixo em chuva durante o Exame X', 'blocked');
      return;
    }
    WeatherSystem.getInstance().setDynamicEnabled(true);
    GarageSystem.getInstance().setActiveModifier('clear');
  };

  // Start Exam
  const handleStartExam = (licenseId: LicenseId) => {
    const licSys = LicenseSystem.getInstance();
    licSys.startExam(licenseId);
    setShowLicenseModal(false);

    // Switch to the exam's vehicle directly (bypassing the license gate that the exam itself grants)
    const lic = licSys.getLicense(licenseId);
    if (lic) {
      handleSelectVehicle(lic.exam.vehicleType, true);
      handleReset(true);
    }
  };

  // Progression Mode (Career vs Sandbox)
  const handleSetGameMode = (mode: GameMode) => {
    const scene = getMainScene();
    if (!scene) return;
    scene.setGameMode(mode);
    if (mode === 'sandbox') {
      addToast('Modo Sandbox ativo — tudo desbloqueado sem alterar a Carreira', 'info', 3400);
    } else {
      addToast('Modo Carreira restaurado', 'success', 2600);
    }
  };

  const handleAcceptMission = (missionId: string) => {
    const scene = getMainScene();
    if (!scene) return;
    const ok = scene.acceptMission(missionId);
    if (!ok) {
      addToast('Não foi possível aceitar esta missão com a configuração atual', 'blocked');
    }
  };

  const handleCancelMission = () => {
    const scene = getMainScene();
    if (scene) {
      scene.cancelActiveMission();
    } else {
      MissionSystem.getInstance().cancelActiveMission();
    }
    addToast('Missão cancelada', 'info', 2200);
  };

  const handleSwapTruck = (truckId: string, remoteSandbox: boolean = false) => {
    const scene = getMainScene();
    if (!scene) return;
    scene.trySwapTruck(truckId, remoteSandbox);
  };

  const handleInstallUpgrade = (slot: UpgradeSlot, value: string) => {
    const scene = getMainScene();
    if (!scene) return;
    scene.installTruckUpgrade(slot, value as never);
  };

  const handleSetEditorTool = (tool: 'pan' | 'road' | 'terrain' | 'object' | 'spawn' | 'add' | 'compound') => {
    setEditorTool(tool);
    editorToolRef.current = tool;
    const edScene = getEditorScene();
    if (edScene) {
      if (tool === 'add') edScene.setAddObjectType(addType);
      edScene.setTool(tool);
    }
  };

  // Drag-to-scroll vertical da toolbar (rato). Touch já faz pan nativo
  // (touch-pan-y); wheel do rato também rola nativamente. Um drag que passou
  // do limiar suprime o click do botão onde o rato foi largado.
  const dockScrollRef = useRef<HTMLDivElement>(null);
  const dockDrag = useRef({ active: false, startY: 0, startScroll: 0, moved: false });
  const handleDockPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return; // touch: scroll nativo
    const el = dockScrollRef.current;
    if (!el) return;
    dockDrag.current = { active: true, startY: e.clientY, startScroll: el.scrollTop, moved: false };
  };
  const handleDockPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dockDrag.current;
    const el = dockScrollRef.current;
    if (!d.active || !el || e.pointerType !== 'mouse') return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) > 6) d.moved = true;
    if (d.moved) {
      el.scrollTop = d.startScroll - dy;
      e.preventDefault();
    }
  };
  const handleDockPointerEnd = () => { dockDrag.current.active = false; };
  const handleDockClickCapture = (e: React.MouseEvent) => {
    if (dockDrag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      dockDrag.current.moved = false;
    }
  };

  const handleSetAddType = (spec: AddObjectSpec) => {
    setAddType(spec);
    const edScene = getEditorScene();
    if (edScene) edScene.setAddObjectType(spec);
  };

  /** Régua do Criar: muda de categoria e auto-selecciona o 1.º objecto dela. */
  const handleSetAddCategory = (catId: string) => {
    setAddCat(catId);
    const cat = CREATE_CATALOG.find((c) => c.id === catId) ?? CREATE_CATALOG[0];
    if (cat.items.length > 0) handleSetAddType(cat.items[0].spec);
  };

  const handleZoomIn = () => {
    const edScene = getEditorScene();
    if (edScene) edScene.zoomIn();
  };

  const handleZoomOut = () => {
    const edScene = getEditorScene();
    if (edScene) edScene.zoomOut();
  };

  const handleResetView = () => {
    const edScene = getEditorScene();
    if (edScene) edScene.resetView();
  };

  // JSON Export / Import (world: seed + roads + objects)
  const handleOpenExport = () => {
    const scene = getMainScene();
    if (scene) {
      setJsonContent(scene.world.exportJSON());
      setJsonError(null);
      setShowJsonModal(true);
    }
  };

  const handleApplyImport = () => {
    const scene = getMainScene();
    if (!scene) return;
    const trimmed = jsonContent.trim();
    if (!trimmed) {
      setJsonError('Erro ao processar JSON: conteúdo vazio.');
      return;
    }
    if (trimmed.length > 8 * 1024 * 1024) {
      setJsonError('Erro ao processar JSON: ficheiro excede o limite máximo de 8 MB.');
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setJsonError('Erro ao processar JSON: o documento deve ser um objeto JSON válido.');
        return;
      }
      if (parsed.roads !== undefined && !Array.isArray(parsed.roads)) {
        setJsonError('Erro ao processar JSON: o campo "roads" deve ser uma lista.');
        return;
      }
      if (parsed.objects !== undefined && !Array.isArray(parsed.objects)) {
        setJsonError('Erro ao processar JSON: o campo "objects" deve ser uma lista.');
        return;
      }
      if (parsed.customMissions !== undefined && !Array.isArray(parsed.customMissions)) {
        setJsonError('Erro ao processar JSON: o campo "customMissions" deve ser uma lista.');
        return;
      }
    } catch {
      setJsonError('Erro ao processar JSON: sintaxe inválida.');
      return;
    }
    const ok = scene.world.importJSON(trimmed);
    if (ok) {
      // Respawn every loose trailer from the imported pads + 'trailer' objects
      scene.rebuildTrailers();
      setShowJsonModal(false);
      setJsonError(null);
    } else {
      setJsonError('Erro ao processar JSON: formato de mapa não reconhecido.');
    }
  };

  const handleDownloadJSON = () => {
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rigworld_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyJSON = async () => {
    try {
      await navigator.clipboard.writeText(jsonContent);
      const scene = getMainScene();
      if (scene) scene.events.emit('toast', { text: 'JSON do mapa copiado para a área de transferência.', color: '#22d3ee' });
    } catch {
      setJsonError('Não foi possível copiar automaticamente — selecione e copie o texto da caixa.');
    }
  };

  // Reseed the island back to its default content
  const handleReseedWorld = () => {
    const scene = getMainScene();
    if (scene) {
      scene.reseedWorld();
      handleReset();
    }
  };

  // Relógio 24h no HUD superior segue o período atual do ciclo dia/noite
  const PeriodIcon = PERIOD_ICONS[telemetry.timePeriod] ?? Sun;

  return (
    <div className="relative w-screen h-dvh overflow-hidden bg-[#0c0f17] font-sans text-slate-100 select-none">
      {/* Phaser Canvas Viewport */}
      <div ref={gameContainerRef} className={`w-full h-full cursor-crosshair ${modalOpen ? 'pointer-events-none' : ''}`} />

      {/* MENU CLICK-AWAY BACKDROP (blocks TouchControls/canvas taps while menu is open) */}
      {isMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/25"
          onClick={() => setIsMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* TOP COMPACT INDUSTRIAL APP BAR */}
      <header className="absolute top-0 left-0 right-0 h-12 bg-slate-950/92 border-b border-cyan-500/30 px-2 sm:px-4 flex items-center justify-between z-50 shadow-lg shadow-black/50">
        <div className="flex items-center gap-1.5 sm:gap-2.5">
        {/* Paint & Drive Mode Switcher */}
          <button
            onClick={handleToggleMode}
            className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded text-[11px] font-bold transition-all border ${
              isEditorMode
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-md shadow-amber-500/20'
                : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/60 shadow-md shadow-cyan-500/20'
            }`}
            title="Alternar Modo (Tab)"
          >
            {isEditorMode ? <Layers className="w-3.5 h-3.5 text-amber-400" /> : <Play className="w-3.5 h-3.5 text-cyan-400" />}
            <span className="hidden md:inline">{isEditorMode ? 'Modo Editor (Paint)' : 'Modo Condução (Editor)'}</span>
            <span className="md:hidden">{isEditorMode ? 'Paint' : 'Editor'}</span>
          </button>
        </div>

        {/* TOP SPEED & GEAR HUD (minimal — warnings are toasts) */}
        {!isEditorMode && (
          <div className="flex items-center gap-2 bg-black/60 border border-cyan-500/40 px-2.5 sm:px-3.5 py-1 rounded-full shadow-inner">
            <div className="flex items-baseline gap-1 whitespace-nowrap">
              <span className="font-mono text-xs font-black text-white">{telemetry.speedKmh}</span>
              <span className="text-[9px] text-slate-400 font-bold uppercase whitespace-nowrap">km/h</span>
            </div>
            <div className="w-px h-3 bg-white/20" />
            <span className={`font-mono text-xs font-black ${telemetry.isReversing ? 'text-amber-400' : 'text-cyan-400'}`}>
              {telemetry.isReversing ? 'R' : 'D'}
            </span>
            {telemetry.brakeHeat >= 0.45 && (
              <>
                <div className="w-px h-3 bg-white/20" />
                <span
                  className={`whitespace-nowrap font-mono tabular-nums text-xs font-bold ${
                    telemetry.brakeHeat >= 0.65 ? 'text-red-400' : 'text-amber-300'
                  }`}
                  title="Temperatura dos travões (fade térmico acima de 55%)"
                >
                  Travões {Math.round(telemetry.brakeHeat * 100)}%
                </span>
              </>
            )}
            {(telemetry.altitudeM >= 25 || Math.abs(telemetry.gradePercent) >= 2.5) && (
              <>
                <div className="w-px h-3 bg-white/20" />
                <span
                  data-testid="hud-mountain-altitude"
                  className="flex items-center gap-1 whitespace-nowrap font-mono tabular-nums text-xs font-bold text-emerald-300"
                  title={`Altitude ${telemetry.altitudeM}m · Inclinação ${telemetry.gradePercent > 0 ? '+' : ''}${telemetry.gradePercent.toFixed(1)}%`}
                >
                  <Mountain className="w-3 h-3 text-emerald-400" />
                  <span>{telemetry.altitudeM}m</span>
                  {Math.abs(telemetry.gradePercent) >= 1.5 && (
                    <span className={telemetry.gradePercent > 0 ? 'text-amber-300' : 'text-sky-300'}>
                      {telemetry.gradePercent > 0 ? `+${Math.round(telemetry.gradePercent)}%` : `${Math.round(telemetry.gradePercent)}%`}
                    </span>
                  )}
                </span>
              </>
            )}
            <div className="w-px h-3 bg-white/20" />
            <span className="flex items-center gap-1 whitespace-nowrap" title="Hora do mundo (24h)">
              <PeriodIcon className="w-3 h-3 text-amber-300" />
              <span className="font-mono text-xs font-black text-amber-100 tabular-nums">{telemetry.timeClock}</span>
            </span>
            {(telemetry.stormIntensity >= 0.15 || telemetry.rainIntensity >= 0.15 || telemetry.fogDensity >= 0.18) && (
              <span
                data-testid="hud-weather-indicator"
                className={`flex items-center ${
                  telemetry.stormIntensity >= 0.15
                    ? 'text-indigo-300'
                    : telemetry.rainIntensity >= 0.15
                      ? 'text-sky-300'
                      : 'text-slate-300'
                }`}
                title={
                  telemetry.stormIntensity >= 0.15
                    ? `Trovoada ${telemetry.stormIntensity >= 0.65 ? 'intensa' : 'local'} · Piso muito escorregadio (${Math.round(telemetry.roadWetness * 100)}%)`
                    : telemetry.rainIntensity >= 0.15
                      ? `Chuva ${telemetry.rainIntensity >= 0.65 ? 'forte' : 'local'} · Piso molhado (${Math.round(telemetry.roadWetness * 100)}%)`
                      : `Nevoeiro local (${Math.round(telemetry.fogDensity * 100)}%)`
                }
              >
                {telemetry.stormIntensity >= 0.15 ? (
                  <CloudLightning className="w-3.5 h-3.5 text-amber-300" />
                ) : telemetry.rainIntensity >= 0.15 ? (
                  <CloudRain className="w-3.5 h-3.5" />
                ) : (
                  <CloudFog className="w-3.5 h-3.5" />
                )}
              </span>
            )}
            {telemetry.gameMode === 'sandbox' && (
              <>
                <div className="w-px h-3 bg-white/20" />
                <span
                  data-testid="hud-sandbox-indicator"
                  className="font-mono text-[10px] font-bold text-amber-300 tracking-wide whitespace-nowrap"
                  title="Modo Sandbox ativo (Carreira preservada)"
                >
                  SANDBOX
                </span>
              </>
            )}
          </div>
        )}

        {/* Action Controls & Consolidated Dropdown Menu */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {/* Full Screen Toggle Button */}
          <button
            onClick={handleToggleFullscreen}
            className={`p-1.5 rounded border transition flex items-center justify-center ${
              isFullscreen ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50' : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
            }`}
            title={isFullscreen ? 'Sair de Ecrã Inteiro' : 'Ecrã Inteiro (Full Screen)'}
          >
            {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
          </button>

          {/* Quick Reset / Emergency Tow Button (disabled during active exam or active Career mission) */}
          {(() => {
            const resetBlocked =
              Boolean(activeExam?.active) ||
              (telemetry.gameMode !== 'sandbox' && Boolean(telemetry.activeMission));
            const resetTitle = activeExam?.active
              ? 'Reposição (R) bloqueada durante exame ativo'
              : telemetry.gameMode !== 'sandbox' && telemetry.activeMission
                ? 'Reboque (R) bloqueado durante missão ativa — cancele a missão primeiro'
                : telemetry.gameMode === 'sandbox'
                  ? 'Repor Camião no Spawn (Tecla R)'
                  : 'Reboque de Emergência / Desencravar na Estrada Mais Próxima (Tecla R)';
            return (
              <button
                onClick={() => handleReset(false)}
                disabled={resetBlocked}
                className={`p-1.5 rounded bg-slate-900 border transition ${
                  resetBlocked
                    ? 'border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                    : 'border-slate-700 hover:border-amber-400 text-amber-400'
                }`}
                title={resetTitle}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            );
          })()}

          {/* THE CONSOLIDATED DROPDOWN MENU */}
          <div className="relative">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-black font-black text-[11px] transition shadow-md shadow-cyan-500/20"
            >
              <Menu className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Menu</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu Overlay */}
            {isMenuOpen && (
              <div
                data-testid="hud-menu-dropdown"
                className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-4.25rem)] overflow-y-auto overscroll-contain touch-pan-y bg-slate-950 border border-cyan-500/50 rounded-xl shadow-2xl p-2.5 z-50 text-xs flex flex-col gap-2.5 backdrop-blur-xl"
              >
                {/* 1. Mode Selector (Career vs Sandbox) */}
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-amber-400 px-2 py-0.5 font-bold">
                    Modo de Jogo
                  </div>
                  <div className="grid grid-cols-2 gap-1 p-1 mt-1 bg-slate-900 rounded-lg border border-slate-800">
                    <button
                      type="button"
                      data-testid="btn-mode-career"
                      onClick={() => handleSetGameMode('career')}
                      className={`py-1.5 px-2 rounded text-[11px] font-semibold transition-colors whitespace-nowrap ${
                        telemetry.gameMode === 'career'
                          ? 'bg-cyan-500 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Carreira
                    </button>
                    <button
                      type="button"
                      data-testid="btn-mode-sandbox"
                      onClick={() => handleSetGameMode('sandbox')}
                      className={`py-1.5 px-2 rounded text-[11px] font-semibold transition-colors whitespace-nowrap flex items-center justify-center gap-1 ${
                        telemetry.gameMode === 'sandbox'
                          ? 'bg-amber-400 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      <FlaskConical className="w-3 h-3" />
                      Sandbox
                    </button>
                  </div>
                </div>

                <div className="h-px bg-slate-800" />

                {/* 2. Vehicles (Direct spawn available in Sandbox only) */}
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 px-2 py-0.5 font-bold flex items-center justify-between">
                    <span>Tipologia de Veículo & Carga</span>
                    {telemetry.gameMode !== 'sandbox' && (
                      <span className="text-[9px] text-amber-400/90 font-normal">SANDBOX</span>
                    )}
                  </div>
                  {telemetry.gameMode === 'sandbox' ? (
                    <div className="flex flex-col gap-0.5 mt-1">
                      {([
                        { id: 'solo', name: 'Solo 4x2 (Camião Rígido)', badge: 'SOLO', req: 'C' },
                        { id: 'standard', name: 'Standard 13.6m', badge: 'C', req: 'C' },
                        { id: 'reefer', name: 'Frigorífico 13.6m', badge: 'C', req: 'C' },
                        { id: 'container', name: 'Porta-Contentores ISO 40ft', badge: 'C', req: 'C' },
                        { id: 'tanker_milk', name: 'Cisterna Leite / Alimentar', badge: 'C', req: 'C' },
                        { id: 'long_cargo', name: 'Pá Eólica 62m', badge: 'C+E', req: 'CE' },
                        { id: 'flatbed_heavy', name: 'Prancha Pesada / Escavadora', badge: 'C+E', req: 'CE' },
                        { id: 'timber', name: 'Florestal / Toros de Madeira', badge: 'C+E', req: 'CE' },
                        { id: 'tanker_fuel', name: 'Cisterna Petróleo / Combustível', badge: 'C+E', req: 'CE' },
                        { id: 'bitrem', name: 'Bitrem B-Double Standard', badge: 'H', req: 'H' },
                        { id: 'bitrem_tanker', name: 'Bitrem Cisterna Combustível', badge: 'H', req: 'H' },
                        { id: 'fragile_glass', name: 'Vidro Óptico Especial', badge: 'X', req: 'X' },
                        { id: 'tanker_hazmat', name: 'Cisterna Líquidos Perigosos ADR', badge: 'X', req: 'X' },
                      ] as Array<{ id: VehicleConfigType; name: string; badge: string; req: LicenseId }>).map((v) => {
                        const unlocked = v.req === 'C' || (licenses.find((l) => l.id === v.req)?.unlocked ?? false);
                        const lockedByExam = Boolean(activeExam?.active);
                        const previewUrl =
                          v.id === 'solo'
                            ? SpriteRegistry.getTruckMenuPreview(telemetry.activeTruckType).url
                            : SpriteRegistry.getTrailerMenuPreview(
                                v.id === 'bitrem'
                                  ? 'bitrem_lead'
                                  : v.id === 'bitrem_tanker'
                                    ? 'bitrem_tanker_lead'
                                    : (v.id as TrailerType),
                              );
                        return (
                          <button
                            key={v.id}
                            onClick={() => {
                              handleSelectVehicle(v.id);
                              setIsMenuOpen(false);
                            }}
                            title={lockedByExam ? 'Troca de veículo bloqueada durante exame ativo' : undefined}
                            className={`text-left px-2 py-1 rounded flex items-center justify-between gap-2 transition ${
                              vehicleConfig === v.id
                                ? 'bg-cyan-500 text-black font-bold'
                                : lockedByExam
                                  ? 'text-slate-600 opacity-60 cursor-not-allowed'
                                  : unlocked
                                    ? 'text-slate-300 hover:bg-slate-900'
                                    : 'text-slate-500 hover:bg-slate-900/70'
                            }`}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <span
                                className={`w-12 h-6 rounded px-1 py-0.5 flex items-center justify-center shrink-0 ${
                                  vehicleConfig === v.id ? 'bg-slate-950/25' : 'bg-slate-900/90 border border-slate-800/80'
                                }`}
                              >
                                <img
                                  src={previewUrl}
                                  alt=""
                                  aria-hidden="true"
                                  referrerPolicy="no-referrer"
                                  loading="lazy"
                                  className="max-w-full max-h-full object-contain"
                                />
                              </span>
                              <span className="truncate">{v.name}</span>
                            </span>
                            <span className="flex items-center gap-1 ml-1 shrink-0">
                              {(!unlocked || lockedByExam) && (
                                <span
                                  className="text-[9px]"
                                  title={lockedByExam ? 'Bloqueado durante exame ativo' : `Requer licença ${v.badge}`}
                                >
                                  🔒
                                </span>
                              )}
                              <span className="text-[9px] font-mono px-1 rounded bg-black/40 text-white">{v.badge}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      data-testid="career-tipologia-notice"
                      className="mt-1 mx-1 px-2.5 py-2 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 leading-snug"
                    >
                      Na Carreira os atrelados são acoplados fisicamente nos parques ou missões. Troca direta disponível no modo <span className="text-amber-300 font-semibold">Sandbox</span>.
                    </div>
                  )}
                </div>

                <div className="h-px bg-slate-800" />

                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-amber-400 px-2 py-0.5 font-bold">
                    Progressão, Frota & Oficina
                  </div>
                  <div className="flex flex-col gap-0.5 mt-1">
                    <button
                      type="button"
                      data-testid="btn-open-missions"
                      onClick={() => {
                        setShowMissionsModal(true);
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-200 hover:bg-slate-900 flex items-center gap-2"
                    >
                      <ClipboardList className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Missões & Certificados</span>
                    </button>
                    <button
                      type="button"
                      data-testid="btn-open-fleet"
                      onClick={() => {
                        setShowFleetModal(true);
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-200 hover:bg-slate-900 flex items-center gap-2"
                    >
                      <Truck className="w-4 h-4 text-cyan-400 shrink-0" />
                      <span>Frota & Camiões ({telemetry.activeTruckName})</span>
                    </button>
                    <button
                      type="button"
                      data-testid="btn-open-workshop"
                      onClick={() => {
                        setShowWorkshopModal(true);
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-200 hover:bg-slate-900 flex items-center gap-2"
                    >
                      <Wrench className="w-4 h-4 text-amber-300 shrink-0" />
                      <span>Oficina de Upgrades</span>
                    </button>
                    <button
                      type="button"
                      data-testid="btn-open-worldmap"
                      onClick={() => {
                        setMapFocusTruckId(null);
                        setShowWorldMapModal(true);
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-200 hover:bg-slate-900 flex items-center gap-2"
                    >
                      <MapIcon className="w-4 h-4 text-sky-400 shrink-0" />
                      <span>Mapa Estratégico (M)</span>
                    </button>
                    <button
                      onClick={() => {
                        setShowLicenseModal(true);
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-300 hover:bg-slate-900 flex items-center gap-2"
                    >
                      <Award className="w-4 h-4 text-cyan-400 shrink-0" />
                      <span>Exames de Licença (C, C+E, H, X)</span>
                    </button>
                    <button
                      onClick={() => {
                        setShowGarageModal(true);
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-300 hover:bg-slate-900 flex items-center gap-2"
                    >
                      <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Garagens & Hubs Regionais</span>
                    </button>
                  </div>
                </div>

                <div className="h-px bg-slate-800" />

                {/* 3. World */}
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 px-2 py-0.5 font-bold">
                    Mundo
                  </div>
                  <div className="flex flex-col gap-0.5 mt-1">
                    <button
                      onClick={() => {
                        handleReseedWorld();
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-300 hover:bg-slate-900"
                    >
                      Restaurar RigWorld Original
                    </button>
                  </div>
                </div>

                <div className="h-px bg-slate-800" />

                {/* 4. Tools */}
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => {
                      handleOpenExport();
                      setIsMenuOpen(false);
                    }}
                    className="text-left px-2 py-1.5 rounded text-slate-300 hover:bg-slate-900 flex items-center gap-2"
                  >
                    <FileCode className="w-4 h-4 text-slate-400" />
                    <span>Importar / Exportar JSON</span>
                  </button>
                  <button
                    onClick={() => {
                      handleToggleDebug();
                      setIsMenuOpen(false);
                    }}
                    className="text-left px-2 py-1.5 rounded text-slate-300 hover:bg-slate-900 flex items-center gap-2"
                  >
                    <Eye className="w-4 h-4 text-slate-400" />
                    <span>Mostrar hitbox: {debugWireframe ? 'ON' : 'OFF'} (P)</span>
                  </button>
                </div>

                <div className="h-px bg-slate-800" />

                {/* 4.5 Time of Day / WebGL Lighting */}
                {(() => {
                  const isSandbox = telemetry.gameMode === 'sandbox';
                  return (
                    <div>
                      <div className="flex items-center justify-between px-2 py-0.5">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-amber-300 font-bold">
                          Período do Dia
                        </span>
                        <span className="font-mono text-[10px] text-slate-300 flex items-center gap-1" data-testid="time-clock">
                          <Clock className="w-3 h-3 text-amber-300" />
                          {telemetry.timeClock}
                        </span>
                      </div>
                      {!isSandbox && (
                        <div className="px-2 pb-1 text-[10px] text-slate-500">
                          Modos fixos disponíveis apenas no modo Sandbox
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1 mt-1">
                        {([
                          { id: 'dawn' as TimePeriod, label: 'Amanhecer', icon: Sunrise },
                          { id: 'day' as TimePeriod, label: 'Dia', icon: Sun },
                          { id: 'dusk' as TimePeriod, label: 'Entardecer', icon: Sunset },
                          { id: 'night' as TimePeriod, label: 'Noite', icon: Moon },
                        ]).map((p) => {
                          const Icon = p.icon;
                          const active = isSandbox && !telemetry.autoTimeCycle && !telemetry.timeRealTime && telemetry.timePeriod === p.id;
                          return (
                            <button
                              key={p.id}
                              data-testid={`btn-period-${p.id}`}
                              disabled={!isSandbox}
                              title={!isSandbox ? 'Disponível apenas no modo Sandbox' : undefined}
                              onClick={() => {
                                if (!isSandbox) return;
                                const garSys = GarageSystem.getInstance();
                                if (p.id !== 'night' && garSys.getActiveModifier() === 'night') {
                                  garSys.setActiveModifier('clear');
                                }
                                TimeOfDaySystem.getInstance().setPeriod(p.id);
                              }}
                              className={`px-2 py-1.5 rounded flex items-center gap-1.5 text-[11px] transition border ${
                                !isSandbox
                                  ? 'bg-slate-900/40 text-slate-600 border-slate-800/60 cursor-not-allowed opacity-60'
                                  : active
                                    ? 'bg-amber-400 text-black font-bold border-amber-300'
                                    : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-900'
                              }`}
                            >
                              <Icon className={`w-3.5 h-3.5 ${!isSandbox ? 'text-slate-600' : active ? 'text-black' : 'text-amber-300'}`} />
                              <span>{p.label}</span>
                            </button>
                          );
                        })}
                      </div>
                      <button
                        data-testid="btn-time-autocycle"
                        onClick={() => {
                          const garSys = GarageSystem.getInstance();
                          if (garSys.getActiveModifier() === 'night') {
                            garSys.setActiveModifier('clear');
                          }
                          if (!isSandbox) {
                            // In Career mode, fixed time is disabled so keep the 24h game cycle active
                            TimeOfDaySystem.getInstance().setAutoCycle(true);
                          } else {
                            TimeOfDaySystem.getInstance().setAutoCycle(!telemetry.autoTimeCycle);
                          }
                        }}
                        className={`mt-1 w-full text-left px-2 py-1.5 rounded flex items-center justify-between transition border ${
                          telemetry.autoTimeCycle
                            ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200 font-bold'
                            : 'bg-slate-900/50 border-slate-800/80 text-slate-300 hover:bg-slate-900'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-[11px]">
                          <Clock className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Ciclo Automático 24h</span>
                        </span>
                        <span className="text-[10px] font-mono">
                          {telemetry.autoTimeCycle ? 'ON' : 'OFF'}
                        </span>
                      </button>
                      <button
                        data-testid="btn-time-realtime"
                        onClick={() => {
                          const garSys = GarageSystem.getInstance();
                          if (telemetry.timeRealTime && garSys.getActiveModifier() === 'night') {
                            garSys.setActiveModifier('clear');
                          }
                          if (!isSandbox && telemetry.timeRealTime) {
                            // Leaving Real Time in Career returns directly to the 24h game cycle
                            TimeOfDaySystem.getInstance().setAutoCycle(true);
                          } else {
                            TimeOfDaySystem.getInstance().setRealTime(!telemetry.timeRealTime);
                          }
                        }}
                        className={`mt-1 w-full text-left px-2 py-1.5 rounded flex items-center justify-between transition border ${
                          telemetry.timeRealTime
                            ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200 font-bold'
                            : 'bg-slate-900/50 border-slate-800/80 text-slate-300 hover:bg-slate-900'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-[11px]">
                          <Watch className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Hora Real (relógio do dispositivo)</span>
                        </span>
                        <span className="text-[10px] font-mono">
                          {telemetry.timeRealTime ? 'ON' : 'OFF'}
                        </span>
                      </button>
                      <button
                        data-testid="btn-menu-weather-dynamic"
                        onClick={() => {
                          if (weatherDynamic && activeWeather === 'clear') {
                            WeatherSystem.getInstance().setDynamicEnabled(false);
                          } else {
                            handleSetDynamicWeather();
                          }
                        }}
                        className={`mt-1 w-full text-left px-2 py-1.5 rounded flex items-center justify-between transition border ${
                          weatherDynamic && activeWeather === 'clear'
                            ? 'bg-sky-500/20 border-sky-400/60 text-sky-200 font-bold'
                            : 'bg-slate-900/50 border-slate-800/80 text-slate-300 hover:bg-slate-900'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-[11px]">
                          <Cloud className="w-3.5 h-3.5 text-sky-400" />
                          <span>Meteorologia Dinâmica</span>
                        </span>
                        <span className="text-[10px] font-mono">
                          {weatherDynamic && activeWeather === 'clear' ? 'ON' : activeWeather !== 'clear' ? 'FIXO' : 'OFF'}
                        </span>
                      </button>
                    </div>
                  );
                })()}

                <div className="h-px bg-slate-800" />

                {/* 5. Settings */}
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 px-2 py-0.5 font-bold">
                    Definições
                  </div>
                  <div className="flex flex-col gap-0.5 mt-1">
                    <button
                      onClick={() => {
                        handleToggleSound();
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-300 hover:bg-slate-900 flex items-center gap-2"
                    >
                      {soundEnabled ? <Volume2 className="w-4 h-4 text-cyan-400" /> : <VolumeX className="w-4 h-4 text-slate-600" />}
                      <span>Som</span>
                      <span className="ml-auto text-[10px]">{soundEnabled ? 'Ligado' : 'Mudo'}</span>
                    </button>
                    <button
                      onClick={() => {
                        setShowTouchControls(!showTouchControls);
                        setIsMenuOpen(false);
                      }}
                      className="text-left px-2 py-1.5 rounded text-slate-300 hover:bg-slate-900 flex items-center gap-2"
                    >
                      <Smartphone className="w-4 h-4 text-cyan-400" />
                      <span>Comandos Touch no HUD</span>
                      <span className="ml-auto text-[10px]">{showTouchControls ? 'Visíveis' : 'Ocultos'}</span>
                    </button>

                    {/* Zoom Slider (covers exceptions without wheel/pinch) */}
                    <div className="px-2 py-1.5 rounded bg-slate-900/60 border border-slate-800/80 flex flex-col gap-1.5 mt-0.5">
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="flex items-center gap-1.5">
                          <ZoomIn className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Zoom da Câmara</span>
                        </span>
                        <span className="font-mono text-[10px] text-cyan-300 font-bold">
                          {Math.round(cameraZoom * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={isEditorMode ? 0.04 : 0.45}
                        max={1.8}
                        step={0.02}
                        value={Math.max(isEditorMode ? 0.04 : 0.45, Math.min(1.8, cameraZoom))}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          lastZoomRef.current = val;
                          setCameraZoom(val);
                          const scene = getMainScene();
                          const edScene = getEditorScene();
                          if (scene?.isEditorMode && edScene) {
                            edScene.cameras.main.setZoom(Math.max(0.04, Math.min(1.8, val)));
                          } else if (scene) {
                            scene.setZoom(val);
                          }
                        }}
                        className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ACTIVE LICENSE EXAM STATUS BANNER */}
      {activeExam && activeExam.active && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-slate-950/95 border border-cyan-400 px-5 py-2.5 rounded-lg shadow-2xl shadow-cyan-500/30 z-30 flex items-center gap-5">
          <div>
            <div className="text-[10px] uppercase font-mono tracking-widest text-cyan-400">EXAME EM CURSO</div>
            <div className="text-sm font-bold text-white">Classe {activeExam.licenseId}</div>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <div>
              <span className="text-slate-400">Tempo:</span>{' '}
              <span className="text-amber-300 font-bold">{Math.ceil(activeExam.remainingTime)}s</span>
            </div>
            <div>
              <span className="text-slate-400">Colisões:</span>{' '}
              <span className={activeExam.collisionCount > 0 ? 'text-red-400 font-bold' : 'text-emerald-400'}>
                {activeExam.collisionCount}
              </span>
            </div>
            {activeExam.maxGForce !== null && (
              <div data-testid="exam-g-meter">
                <span className="text-slate-400">G-Meter:</span>{' '}
                <span
                  className={
                    activeExam.currentGForce > activeExam.maxGForce
                      ? 'text-red-400 font-bold'
                      : activeExam.currentGForce > activeExam.maxGForce * 0.75
                        ? 'text-amber-300 font-bold'
                        : 'text-emerald-400 font-bold'
                  }
                >
                  {activeExam.currentGForce.toFixed(2)}g / {activeExam.maxGForce.toFixed(1)}g
                </span>
              </div>
            )}
            <div>
              <span className="text-slate-400">Doca:</span>{' '}
              {activeExam.inDockZone ? (
                <span className="text-emerald-400 font-bold">
                  {activeExam.dockHoldSec > 0
                    ? `A alinhar… ${activeExam.dockHoldSec.toFixed(1)}s / 1.5s`
                    : 'Na Área da Doca'}
                </span>
              ) : (
                <span className="text-slate-400">Em aproximação</span>
              )}
            </div>
          </div>

          <button
            onClick={() => LicenseSystem.getInstance().cancelExam()}
            className="text-xs bg-red-950 text-red-300 px-2 py-1 rounded border border-red-800 hover:bg-red-900"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* EXAM RESULT POPUP */}
      {activeExam && (activeExam.isPassed || activeExam.isFailed) && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4 pointer-events-none">
          <div className="bg-slate-900 border border-slate-700 max-w-md w-full p-6 rounded-xl shadow-2xl text-center pointer-events-auto">
            {activeExam.isPassed ? (
              <>
                <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500">
                  <CheckCircle className="w-10 h-10" />
                </div>
                <h3 className="text-xl font-bold text-white mb-1">Parabéns! Exame Aprovado</h3>
                <p className="text-sm text-emerald-400 font-mono mb-4">
                  Licença de Classe {activeExam.licenseId} desbloqueada com sucesso!
                </p>
                <p className="text-xs text-slate-300 mb-6">
                  Novos veículos e atrelados agora estão disponíveis no simulador e no editor de mapas.
                </p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-red-500/20 text-red-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-500">
                  <XCircle className="w-10 h-10" />
                </div>
                <h3 className="text-xl font-bold text-white mb-1">Exame Chumbado</h3>
                <p className="text-sm text-red-400 font-mono mb-4">{activeExam.failReason || 'Critérios não cumpridos'}</p>
                <p className="text-xs text-slate-300 mb-6">
                  Tenta novamente ajustando a geometria da manobra, o varrimento de traseira e a trajetória dos eixos.
                </p>
              </>
            )}

            <button
              onClick={() => LicenseSystem.getInstance().cancelExam()}
              className="w-full py-2.5 rounded bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-sm transition pointer-events-auto"
            >
              Continuar
            </button>
          </div>
        </div>
      )}

      {/* MINIMAP TAP/CLICK HOTSPOT — opens Strategic World Map directly on mobile & desktop */}
      {!isEditorMode && !modalOpen && (
        <button
          type="button"
          data-testid="minimap-open-map-btn"
          aria-label="Abrir Mapa Estratégico"
          title="Abrir Mapa Estratégico (M)"
          onClick={() => {
            setMapFocusTruckId(null);
            setShowWorldMapModal(true);
            setIsMenuOpen(false);
          }}
          className="fixed right-[10px] top-[58px] w-[116px] h-[116px] sm:w-[150px] sm:h-[150px] z-20 rounded-sm bg-transparent hover:ring-2 hover:ring-cyan-400/80 active:bg-cyan-500/15 transition cursor-pointer flex items-end justify-end p-1"
        >
          <span className="px-1.5 py-0.5 rounded bg-slate-950/85 border border-cyan-500/40 text-[9px] font-semibold text-cyan-300 leading-none pointer-events-none">
            Mapa
          </span>
        </button>
      )}

      {/* ACTIVE MISSION COMPACT BANNER (positioned clear of the top-right Minimap on all screen widths) */}
      {!isEditorMode && telemetry.activeMission && !(activeExam && activeExam.active) && (() => {
        const am = telemetry.activeMission;
        const nav = telemetry.missionNavTarget;
        const isPickup = am.phase === 'pickup';
        const distLabel = nav
          ? nav.distPx < 1000
            ? `${Math.round(nav.distPx)} m`
            : `${(nav.distPx / 1000).toFixed(1)} km`
          : null;
        return (
          <div
            data-testid="active-mission-banner"
            className={`absolute top-[58px] left-2 right-[134px] sm:right-[170px] lg:left-1/2 lg:right-auto lg:-translate-x-1/2 lg:max-w-[calc(100vw-360px)] bg-slate-950/92 border ${
              isPickup ? 'border-amber-500/60' : 'border-emerald-500/60'
            } px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-lg shadow-xl z-30`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wide shrink-0 ${
                      isPickup ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    <span className="sm:hidden">{isPickup ? '1/2 Recolha' : '2/2 Entrega'}</span>
                    <span className="hidden sm:inline">{isPickup ? 'Passo 1/2 · Recolha' : 'Passo 2/2 · Entrega'}</span>
                  </span>
                  <span className="text-[11px] sm:text-xs font-semibold text-white truncate">
                    {am.mission.title}
                  </span>
                </div>
                <div className={`text-[10px] sm:text-[11px] leading-snug truncate ${isPickup ? 'text-amber-200/90' : 'text-slate-300'}`}>
                  {isPickup
                    ? nav
                      ? `${nav.needsPupOnly ? 'Engatar' : 'Recolher'} ${nav.trailerLabel} · ${nav.pickupHubName}${distLabel ? ` · ${distLabel}` : ''}${nav.hasWrongTrailerCoupled ? ' (C deseng.)' : ''}`
                      : `Recolher em ${am.mission.originHubName}`
                    : `${am.mission.targetHubName} · ${am.mission.targetDock.label}${distLabel ? ` · ${distLabel}` : ''}`}
                </div>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-0.5 text-[10px] sm:text-xs font-mono tabular-nums">
                  <span className="text-slate-300">
                    {Math.floor(am.elapsedSec)}s/{am.mission.targetTimeSec}s
                  </span>
                  <span className={am.minCargoHealth < 90 ? 'text-amber-300' : 'text-emerald-300'}>
                    Carga {Math.round(am.minCargoHealth)}%
                  </span>
                  <span className={am.collisions > 0 ? 'text-red-400' : 'text-slate-300'}>
                    Col {am.collisions}
                  </span>
                  {am.inTargetDock && (
                    <span className="text-emerald-400 font-semibold">
                      Doca {am.dockHoldSec.toFixed(1)}s/1.5s
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                aria-label="Cancelar missão"
                onClick={handleCancelMission}
                className="shrink-0 text-[10px] sm:text-xs px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded bg-slate-900 hover:bg-red-950 text-red-300 border border-slate-700 hover:border-red-800 transition-colors whitespace-nowrap"
              >
                <span className="sm:hidden">✕</span>
                <span className="hidden sm:inline">Cancelar</span>
              </button>
            </div>
          </div>
        );
      })()}

      {/* MISSION COMPLETION SUMMARY MODAL */}
      {telemetry.lastMissionCompletion && (
        <div
          data-testid="mission-completion-modal"
          className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[65] flex items-center justify-center p-2.5 sm:p-4"
        >
          <div className="bg-slate-950 border border-emerald-500/50 max-w-md w-full max-h-[92dvh] overflow-y-auto overscroll-contain p-4 sm:p-6 rounded-xl shadow-2xl space-y-3.5 sm:space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-emerald-400">Missão Concluída</div>
                <h3 className="text-base sm:text-lg font-bold text-white mt-0.5 leading-snug">
                  {telemetry.lastMissionCompletion.mission.title}
                </h3>
                <div className="text-xs text-slate-400">
                  {telemetry.lastMissionCompletion.mission.originHubName} → {telemetry.lastMissionCompletion.mission.targetHubName}
                </div>
              </div>
              <div className="text-2xl sm:text-3xl font-black font-mono tabular-nums text-emerald-300 leading-none px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-slate-900 border border-slate-800 shrink-0">
                {telemetry.lastMissionCompletion.rating}
              </div>
            </div>

            <div className="border-t border-b border-slate-800 py-3 space-y-1.5 text-xs font-mono tabular-nums">
              <div className="flex justify-between">
                <span className="text-slate-400">Reputação ganha ({telemetry.lastMissionCompletion.mission.originHubName})</span>
                <span className="text-emerald-300 font-bold">+{telemetry.lastMissionCompletion.reputationAwarded} rep</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Fórmula</span>
                <span>
                  {telemetry.lastMissionCompletion.baseReputation} × {telemetry.lastMissionCompletion.ratingMultiplier.toFixed(1)} × {telemetry.lastMissionCompletion.riskMultiplier.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Total no hub</span>
                <span className="text-slate-200">{telemetry.lastMissionCompletion.hubReputationAfter.toLocaleString('pt-PT')} rep</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Alinhamento / Colisões / Carga</span>
                <span className="text-slate-200">
                  {telemetry.lastMissionCompletion.metrics.alignmentDeg.toFixed(1)}° · {telemetry.lastMissionCompletion.metrics.collisions} · {Math.round(telemetry.lastMissionCompletion.metrics.minCargoHealth)}%
                </span>
              </div>
            </div>

            {telemetry.lastMissionCompletion.newlyUnlockedCertificates.length > 0 && (
              <div className="text-xs text-amber-300 space-y-0.5">
                <div className="font-semibold">Novo Certificado Desbloqueado:</div>
                {telemetry.lastMissionCompletion.newlyUnlockedCertificates.map((cid) => (
                  <div key={cid}>{CERTIFICATE_CATALOG[cid]?.name ?? cid}</div>
                ))}
              </div>
            )}

            {telemetry.lastMissionCompletion.newlyUnlockedTrucks.length > 0 && (
              <div className="text-xs text-cyan-300 space-y-0.5">
                <div className="font-semibold">Novo Camião Desbloqueado no Mapa:</div>
                {telemetry.lastMissionCompletion.newlyUnlockedTrucks.map((tid) => (
                  <div key={tid}>
                    {TRUCK_CATALOG[tid]?.name ?? tid} — {TRUCK_CATALOG[tid]?.locationLabel}
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => MissionSystem.getInstance().clearLastCompletion()}
              className="w-full py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm transition-colors"
            >
              Continuar
            </button>
          </div>
        </div>
      )}

      {/* PHYSICAL TRUCK SWAP PROMPT (when stopped/approaching an unlocked parked truck <= 160 px) */}
      {!isEditorMode && telemetry.nearbySwapTruck && !modalOpen && (
        <div
          data-testid="swap-truck-prompt"
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 bg-slate-950/95 border border-emerald-500/60 px-4 py-2 rounded-lg shadow-xl flex items-center gap-3"
        >
          <div className="text-xs">
            <div className="font-semibold text-white">{telemetry.nearbySwapTruck.name}</div>
            <div className="text-[11px] text-slate-400 font-mono tabular-nums">
              {Math.round(telemetry.nearbySwapTruck.dist)} px · {Math.abs(telemetry.speedKmh) <= 3 ? 'Pronto para trocar (T)' : 'Pare totalmente'}
            </div>
          </div>
          <button
            type="button"
            disabled={Math.abs(telemetry.speedKmh) > 3}
            onClick={() => handleSwapTruck(telemetry.nearbySwapTruck!.id, false)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              Math.abs(telemetry.speedKmh) <= 3
                ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            Assumir Controlo (T)
          </button>
        </div>
      )}



      {/* EDITOR MODE: SLEEK LEFT DOCK & SLIDE-OUT FLYOUT CATALOG */}
      {isEditorMode && (
        <>
          {/* 1. SLIM LEFT VERTICAL DOCK / SIDEBAR — scrollable (up & down) */}
          <aside className="absolute left-0 top-12 bottom-0 w-[74px] md:w-[88px] z-30 bg-slate-950/95 border-r border-amber-500/40 flex flex-col items-center py-2.5 px-1 shadow-2xl select-none">
            {/* Scroll container: tools + ALL object categories — rola com a roda
                do rato / drag / touch, mas nunca mostra barras nem rola na horizontal */}
            <div
              ref={dockScrollRef}
              className="w-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar overscroll-contain touch-pan-y flex flex-col items-center gap-2 pb-1"
              onPointerDown={handleDockPointerDown}
              onPointerMove={handleDockPointerMove}
              onPointerUp={handleDockPointerEnd}
              onPointerCancel={handleDockPointerEnd}
              onClickCapture={handleDockClickCapture}
            >
              {/* Tool: Mover (Pan / travel the map) */}
              <button
                onClick={() => handleSetEditorTool('pan')}
                className={`w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg flex flex-col items-center justify-center transition border shrink-0 ${
                  editorTool === 'pan'
                    ? 'bg-cyan-500 text-black border-cyan-300 shadow-md shadow-cyan-500/40 animate-pulse'
                    : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
                title="Mover (Pan) — Arrasta no ecrã para viajar livremente pelo mapa"
              >
                <Hand className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Mover</span>
              </button>

              {/* Tool: Undo (desfaz a última operação da sessão de editor) */}
              <button
                onClick={() => { const ed = getEditorScene(); if (ed) ed.undo(); }}
                className={`w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg flex flex-col items-center justify-center transition border shrink-0 ${
                  'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
                disabled={!objectUI.canUndo}
                title="Desfazer última operação da sessão (Ctrl+Z)"
              >
                <Undo className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Desfazer</span>
              </button>

              {/* Tool: Estrada (vector roads: draw, select, drag handles, delete) */}
              <button
                onClick={() => handleSetEditorTool('road')}
                className={`w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg flex flex-col items-center justify-center transition border shrink-0 ${
                  editorTool === 'road'
                    ? 'bg-sky-500 text-black border-sky-300 shadow-md shadow-sky-500/40 animate-pulse'
                    : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
                title="Estradas Livres — Desenha estradas por splines, edita pontos, muda piso/largura"
              >
                <Route className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Estrada</span>
              </button>

              {/* Tool: Terreno (freeform surface brush + eraser with automatic shoreline clipping) */}
              <button
                data-testid="btn-editor-terrain"
                onClick={() => handleSetEditorTool('terrain')}
                className={`w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg flex flex-col items-center justify-center transition border shrink-0 ${
                  editorTool === 'terrain'
                    ? 'bg-teal-400 text-black border-teal-200 shadow-md shadow-teal-500/40 animate-pulse'
                    : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
                title="Pintar Terreno — Pincel livre para betão, alcatrão, calçada, terra, areia, relva, floresta, rocha ou água"
              >
                <Paintbrush className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Terreno</span>
              </button>

              {/* Tool: Objectos (select / move / rotate / delete / duplicate any prefab) */}
              <button
                onClick={() => handleSetEditorTool('object')}
                className={`w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg flex flex-col items-center justify-center transition border shrink-0 ${
                  editorTool === 'object'
                    ? 'bg-amber-500 text-black border-amber-300 shadow-md shadow-amber-500/40 animate-pulse'
                    : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
                title="Objectos — Seleciona, move, roda (R), duplica (Ctrl+D) e apaga (Del) edifícios, docas, barreiras, semáforos…"
              >
                <Box className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Objectos</span>
              </button>

              {/* Tool: Composto (marquee selection → novo objecto composto) */}
              <button
                onClick={() => handleSetEditorTool('compound')}
                className={`w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg flex flex-col items-center justify-center transition border shrink-0 ${
                  editorTool === 'compound'
                    ? 'bg-violet-500 text-black border-violet-300 shadow-md shadow-violet-500/40 animate-pulse'
                    : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
                title="Composto — Arrasta um rectângulo à volta dos objectos para agrupar tudo num único objecto composto"
              >
                <CopyPlus className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Composto</span>
              </button>

              {/* Tool: Spawn Point */}
              <button
                onClick={() => handleSetEditorTool('spawn')}
                className={`w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg flex flex-col items-center justify-center transition border shrink-0 ${
                  editorTool === 'spawn'
                    ? 'bg-emerald-500 text-black border-emerald-300 shadow-md shadow-emerald-500/40 animate-pulse'
                    : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
                title="Definir Ponto de Spawn do Camião (clica no mapa)"
              >
                <Compass className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Spawn</span>
              </button>

              {/* Subtle Divider */}
              <div className="w-8 h-px bg-slate-800 my-0.5 shrink-0" />

              {/* CATEGORY BUTTONS — each opens its object submenu to the right */}
              {CREATE_CATALOG.map((cat) => {
                const CatIcon = cat.icon;
                const catActive = editorTool === 'add' && addCat === cat.id;
                return (
                  <button
                    key={cat.id}
                    data-cat={cat.id}
                    onClick={() => { handleSetEditorTool('add'); handleSetAddCategory(cat.id); }}
                    className={`w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg flex flex-col items-center justify-center transition border shrink-0 ${
                      catActive
                        ? 'bg-violet-500 text-black border-violet-300 shadow-md shadow-violet-500/40 animate-pulse'
                        : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                    }`}
                    title={`Criar — ${cat.label}: abre as subopções a rolar para a direita`}
                  >
                    <CatIcon className="ed-icon" />
                    <span className="ed-fs-xs font-bold mt-0.5 leading-tight text-center">{cat.label}</span>
                  </button>
                );
              })}

              {/* Subtle Divider */}
              <div className="w-8 h-px bg-slate-800 my-0.5 shrink-0" />

              {/* Custom Missions Editor */}
              <button
                type="button"
                data-testid="btn-editor-missions"
                onClick={() => {
                  setMissionEditorHubId(null);
                  setShowMissionEditorModal(true);
                }}
                className="relative w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg bg-slate-900/90 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/15 hover:text-cyan-200 flex flex-col items-center justify-center transition shrink-0"
                title="Criar e gerir missões personalizadas entre HUBs"
              >
                <ClipboardList className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Missões</span>
                {customMissionCount > 0 && (
                  <span className="absolute top-1 right-1 px-1 rounded bg-cyan-500 text-slate-950 font-mono text-[9px] font-black leading-tight">
                    {customMissionCount}
                  </span>
                )}
              </button>

              {/* Navigation: Fit Entire Map (Ver o mapa todo) */}
              <button
                onClick={handleResetView}
                className="w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg bg-slate-900/90 text-amber-400 border border-slate-800 hover:bg-slate-800 hover:text-amber-300 flex flex-col items-center justify-center transition shrink-0"
                title="Ver Mapa Todo (Ajustar Zoom ao Ecrã)"
              >
                <Maximize2 className="ed-icon" />
                <span className="ed-fs-xs font-bold mt-0.5">Ver Tudo</span>
              </button>

              {/* Navigation: Zoom In (+) */}
              <button
                onClick={handleZoomIn}
                className="w-[66px] h-9 md:w-[80px] rounded-lg bg-slate-900/80 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-white flex items-center justify-center transition shrink-0"
                title="Aumentar Zoom (+)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              {/* Navigation: Zoom Out (-) */}
              <button
                onClick={handleZoomOut}
                className="w-[66px] h-9 md:w-[80px] rounded-lg bg-slate-900/80 text-slate-300 border border-slate-800 hover:bg-slate-800 hover:text-white flex items-center justify-center transition shrink-0"
                title="Reduzir Zoom (-)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Divider + Drive button (pinned to the bottom, outside the scroll) */}
            <div className="w-8 h-px bg-slate-800 my-1 shrink-0" />
            <button
              onClick={handleToggleMode}
              className="w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg bg-amber-500 hover:bg-amber-400 text-black border border-amber-300 flex flex-col items-center justify-center transition shadow-lg shadow-amber-500/30 shrink-0"
              title="Testar Condução Imediata (Tecla Tab)"
            >
              <Play className="ed-icon fill-black" />
              <span className="ed-fs-xs font-black uppercase mt-0.5">Drive</span>
            </button>

            {/* Botão Cancelar — desfaz TODAS as alterações da sessão de editor */}
            <button
              onClick={() => {
                const ed = getEditorScene();
                if (ed) ed.cancelSession();
                handleToggleMode();
              }}
              className="w-[66px] h-14 md:w-[80px] md:h-16 rounded-lg bg-red-950/90 text-red-300 border border-red-700 hover:bg-red-900 hover:text-red-200 flex flex-col items-center justify-center transition shadow-lg shadow-red-900/30 shrink-0"
              title="Cancelar sessão — descarta todas as alterações do editor"
            >
              <AlertTriangle className="ed-icon" />
              <span className="ed-fs-xs font-bold mt-0.5">Cancelar</span>
            </button>

            {/* FLYOUT — submenu da categoria ativa, sempre no topo da toolbar,
                a rolar para a direita (posição fixa: não segue o botão quando a barra rola) */}
            {editorTool === 'add' && (
              <div
                className="absolute top-2 left-[74px] md:left-[90px] z-40 w-48 sm:w-52 md:w-56 max-w-[calc(100vw-4.5rem)] max-h-[calc(100dvh-9rem)] overflow-y-auto overflow-x-hidden no-scrollbar overscroll-contain touch-pan-y bg-slate-950/95 border border-violet-400/60 rounded-xl shadow-2xl py-1.5 px-1.5 flex flex-col gap-1"
              >
                <div className="ed-fs-sm font-mono uppercase tracking-wider text-violet-300 px-1 pb-0.5 font-bold shrink-0">
                  {(() => { const c = CREATE_CATALOG.find((x) => x.id === addCat) ?? CREATE_CATALOG[0]; return c.label; })()}
                </div>
                {(CREATE_CATALOG.find((c) => c.id === addCat) ?? CREATE_CATALOG[0]).items.map(({ spec, icon: Icon }) => (
                  <button
                    key={spec.label}
                    onClick={() => handleSetAddType(spec)}
                    className={`shrink-0 flex items-center gap-1.5 ed-fs font-bold px-2 py-1.5 rounded border transition text-left ${
                      addType.label === spec.label
                        ? 'bg-violet-500 text-black border-violet-300'
                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{spec.label}</span>
                  </button>
                ))}
                <div className="ed-fs-sm text-slate-500 px-1 pt-0.5 shrink-0">clica no mapa para colocar</div>
              </div>
            )}

            {/* FLYOUT — Pincel de Terreno (pintar superfícies arbitrárias + borracha + corte de costa) */}
            {editorTool === 'terrain' && (
              <div
                data-testid="panel-editor-terrain"
                className="absolute top-2 left-[74px] md:left-[90px] z-40 w-60 sm:w-64 max-w-[calc(100vw-4.75rem)] max-h-[calc(100dvh-9rem)] overflow-y-auto overflow-x-hidden no-scrollbar overscroll-contain touch-pan-y bg-slate-950/95 border border-teal-400/60 rounded-xl shadow-2xl p-2 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between px-0.5">
                  <span className="ed-fs-sm font-mono uppercase tracking-wider text-teal-300 font-bold">
                    Pincel Terreno
                  </span>
                  <span className="ed-fs-xs font-mono text-slate-400">
                    {terrainUI.strokeCount} {terrainUI.strokeCount === 1 ? 'traço' : 'traços'}
                  </span>
                </div>

                {/* Mode: Pintar vs Apagar */}
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    data-testid="btn-terrain-mode-paint"
                    onClick={() => getEditorScene()?.setTerrainBrushMode('paint')}
                    className={`flex items-center justify-center gap-1.5 ed-fs font-bold py-1.5 px-2 rounded border transition ${
                      terrainUI.mode === 'paint'
                        ? 'bg-teal-400 text-slate-950 border-teal-200'
                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Paintbrush className="w-3.5 h-3.5" />
                    <span>Pintar</span>
                  </button>
                  <button
                    type="button"
                    data-testid="btn-terrain-mode-erase"
                    onClick={() => getEditorScene()?.setTerrainBrushMode('erase')}
                    className={`flex items-center justify-center gap-1.5 ed-fs font-bold py-1.5 px-2 rounded border transition ${
                      terrainUI.mode === 'erase'
                        ? 'bg-rose-500 text-white border-rose-300'
                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    <span>Apagar</span>
                  </button>
                </div>

                {/* Surface Material Palette (10 seamless surfaces) */}
                <div>
                  <div className="ed-fs-xs font-mono uppercase tracking-wider text-slate-400 mb-1 px-0.5">
                    Textura de Superfície
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {TERRAIN_PAINT_CATALOG.map((mat) => {
                      const active = terrainUI.mode === 'paint' && terrainUI.material === mat.id;
                      return (
                        <button
                          key={mat.id}
                          type="button"
                          data-testid={`btn-terrain-mat-${mat.id}`}
                          onClick={() => getEditorScene()?.setTerrainBrushMaterial(mat.id)}
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded border text-left transition ${
                            active
                              ? 'bg-teal-500/25 border-teal-300 text-white shadow-sm shadow-teal-500/30'
                              : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white'
                          }`}
                          title={`${mat.label} · Aderência ${Math.round(mat.grip * 100)}%${mat.clearsTrees ? ' · Limpa árvores' : ''}`}
                        >
                          <span
                            className="w-3.5 h-3.5 rounded-sm border border-white/25 shrink-0"
                            style={{ backgroundColor: mat.swatch }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="ed-fs-xs font-bold leading-tight truncate">{mat.shortLabel}</div>
                            <div className="text-[9px] font-mono text-slate-400 leading-tight">
                              {Math.round(mat.grip * 100)}% ader.
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Brush Radius Slider & Quick Presets */}
                <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-2 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="ed-fs-xs font-mono uppercase text-slate-400">Raio do Pincel</span>
                    <span className="ed-fs-xs font-mono font-bold text-teal-300">{terrainUI.radius} px</span>
                  </div>
                  <input
                    type="range"
                    data-testid="input-terrain-radius"
                    min={24}
                    max={360}
                    step={8}
                    value={terrainUI.radius}
                    onChange={(e) => getEditorScene()?.setTerrainBrushRadius(Number(e.target.value))}
                    className="w-full accent-teal-400 cursor-pointer h-1.5"
                  />
                  <div className="grid grid-cols-4 gap-1">
                    {[48, 96, 180, 300].map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => getEditorScene()?.setTerrainBrushRadius(r)}
                        className={`py-0.5 rounded text-[10px] font-mono font-bold border transition ${
                          Math.abs(terrainUI.radius - r) <= 8
                            ? 'bg-teal-400/20 text-teal-200 border-teal-400/70'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Edge Softness + Water Clipping */}
                <div className="flex flex-col gap-1.5">
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      data-testid="btn-terrain-soft"
                      onClick={() => getEditorScene()?.setTerrainBrushSoftness('soft')}
                      className={`py-1 px-2 rounded ed-fs-xs font-bold border transition ${
                        terrainUI.softness === 'soft'
                          ? 'bg-slate-700 text-white border-teal-400/80'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      Borda Suave
                    </button>
                    <button
                      type="button"
                      data-testid="btn-terrain-hard"
                      onClick={() => getEditorScene()?.setTerrainBrushSoftness('hard')}
                      className={`py-1 px-2 rounded ed-fs-xs font-bold border transition ${
                        terrainUI.softness === 'hard'
                          ? 'bg-slate-700 text-white border-teal-400/80'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      Borda Nítida
                    </button>
                  </div>

                  <button
                    type="button"
                    data-testid="btn-terrain-clip-water"
                    onClick={() => getEditorScene()?.setTerrainBrushClipWater(!terrainUI.clipWater)}
                    className={`flex items-center justify-between px-2 py-1.5 rounded border ed-fs-xs font-bold transition ${
                      terrainUI.clipWater
                        ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/60'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                    title="Quando ativo, a pintura nunca ultrapassa margens, lagos ou oceano (exceto ao pintar Água)"
                  >
                    <span className="flex items-center gap-1.5">
                      <Waves className="w-3.5 h-3.5" />
                      <span>Respeitar Costa / Água</span>
                    </span>
                    <span className="font-mono text-[10px] uppercase">
                      {terrainUI.clipWater ? 'ON' : 'OFF'}
                    </span>
                  </button>
                </div>

                {/* Clear All (undoable via Ctrl+Z) */}
                <button
                  type="button"
                  data-testid="btn-terrain-clear-all"
                  disabled={terrainUI.strokeCount === 0}
                  onClick={() => getEditorScene()?.clearAllTerrainPaints()}
                  className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded border border-red-900/70 bg-red-950/60 text-red-300 hover:bg-red-900/70 disabled:opacity-35 disabled:cursor-not-allowed ed-fs-xs font-bold transition"
                  title="Apaga todas as pinturas de terreno (reversível com Desfazer / Ctrl+Z)"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Limpar Pintura</span>
                </button>

                <div className="text-[10px] text-slate-400 leading-snug px-0.5">
                  Arrasta para pintar · <span className="font-mono text-slate-300">[ ]</span> tamanho ·{' '}
                  <span className="font-mono text-slate-300">X</span> borracha · botão direito move o mapa
                </div>
              </div>
            )}
            {/* FLYOUT — submenu da ferramenta Estrada (superfície, sentido, largura, tangente) */}
            {editorTool === 'road' && (
              <div
                className="absolute top-2 left-[74px] md:left-[90px] z-40 w-48 sm:w-52 md:w-56 max-w-[calc(100vw-4.5rem)] max-h-[calc(100dvh-9rem)] overflow-y-auto overflow-x-hidden no-scrollbar overscroll-contain touch-pan-y bg-slate-950/95 border border-sky-400/60 rounded-xl shadow-2xl py-1.5 px-1.5 flex flex-col gap-1"
              >
                <div className="ed-fs-sm font-mono uppercase tracking-wider text-sky-300 px-1 pb-0.5 font-bold shrink-0">ESTRADA</div>
                {([['asphalt', 'Asfalto'], ['dirt', 'Terra'], ['cobble', 'Calçada']] as Array<[RoadSurface, string]>).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => { const ed = getEditorScene(); if (ed) ed.setRoadSurface(id); }}
                    className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border transition text-left ${
                      roadUI.surface === id
                        ? 'bg-sky-500 text-black border-sky-300'
                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  onClick={() => { const ed = getEditorScene(); if (ed) ed.setRoadOneWay(!roadUI.oneWay); }}
                  className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border transition text-left ${
                    roadUI.oneWay
                      ? 'bg-amber-400 text-black border-amber-200'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {roadUI.oneWay ? '→ 1 Sentido' : '⇄ 2 Sentidos'}
                </button>
                <button
                  data-testid="btn-road-layer-toggle"
                  onClick={() => { const ed = getEditorScene(); if (ed) ed.setRoadLayer(roadUI.layer > 0 ? 0 : 1); }}
                  className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border transition text-left ${
                    roadUI.layer > 0
                      ? 'bg-amber-500 text-black border-amber-300 shadow-md shadow-amber-500/20'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                  title="Alternar entre Estrada no Solo (Piso 0) e Ponte/Viaduto com rampas automáticas (Piso 1)"
                >
                  {roadUI.layer > 0 ? '🌉 Viaduto (Piso 1)' : '🛣️ Solo (Piso 0)'}
                </button>
                {roadUI.layer > 0 && roadUI.tooShort && (
                  <div className="shrink-0 ed-fs-sm font-bold text-amber-300 bg-amber-950/60 border border-amber-500/40 rounded px-2 py-1">
                    Ponte curta — rampas ajustadas automaticamente
                  </div>
                )}
                {roadUI.layer === 0 && (
                  <div className="shrink-0 flex flex-col gap-1 bg-slate-900/90 border border-slate-700/80 rounded px-1.5 py-1">
                    <div className="ed-fs-xs font-mono uppercase tracking-wider text-slate-300 font-bold">
                      Guardas na Estrada
                    </div>
                    <div className="grid grid-cols-5 gap-0.5">
                      {([
                        ['none', 'Off', 'Sem barreiras protetoras'],
                        ['curves', 'Curvas', 'Coloca guarda metálica automaticamente no exterior das curvas'],
                        ['both', 'Ambos', 'Guarda metálica em ambos os lados da estrada'],
                        ['left', 'Esq.', 'Guarda metálica apenas do lado esquerdo'],
                        ['right', 'Dir.', 'Guarda metálica apenas do lado direito'],
                      ] as Array<[RoadGuardrailMode, string, string]>).map(([mode, lbl, tip]) => (
                        <button
                          key={mode}
                          data-testid={`btn-road-guardrail-${mode}`}
                          onClick={() => { const ed = getEditorScene(); if (ed) ed.setRoadGuardrail(mode); }}
                          title={tip}
                          className={`ed-fs-xs font-bold py-1 px-0.5 rounded border text-center transition ${
                            roadUI.guardrail === mode
                              ? 'bg-amber-400 text-black border-amber-200'
                              : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="shrink-0 flex items-center gap-1 bg-slate-900 border border-sky-800 rounded px-1 py-0.5 shrink-0">
                  <button onClick={() => { const ed = getEditorScene(); if (ed) ed.nudgeRoadWidth(-16); }} className="text-slate-300 hover:text-white px-1 font-black ed-fs-lg" title="Reduzir largura">−</button>
                  <span className="ed-fs font-bold text-slate-200 w-12 text-center">{roadUI.hasPoint ? 'Secção ' : ''}{Math.round(roadUI.width)}px</span>
                  <button onClick={() => { const ed = getEditorScene(); if (ed) ed.nudgeRoadWidth(16); }} className="text-slate-300 hover:text-white px-1 font-black ed-fs-lg" title="Aumentar largura">+</button>
                </div>
                {roadUI.hasPoint && (
                  <div className="shrink-0 flex items-center gap-1 bg-slate-900 border border-violet-500/60 rounded px-1 py-0.5 shrink-0">
                    <span className="ed-fs-sm font-bold text-violet-300 px-0.5">Tangente</span>
                    <button onClick={() => { const ed = getEditorScene(); if (ed) ed.nudgeTwist(-5); }} className="text-slate-300 hover:text-white px-1 font-black ed-fs-lg">−</button>
                    <span className="ed-fs font-bold text-slate-200 w-8 text-center">{roadUI.twistDeg}°</span>
                    <button onClick={() => { const ed = getEditorScene(); if (ed) ed.nudgeTwist(5); }} className="text-slate-300 hover:text-white px-1 font-black ed-fs-lg">+</button>
                    <button onClick={() => { const ed = getEditorScene(); if (ed) ed.resetTwist(); }} className="ed-fs-sm font-bold text-violet-300 hover:text-white px-1">Reta</button>
                  </div>
                )}
                {roadUI.hasPoint && roadUI.layer === 0 && (
                  <div className="shrink-0 flex flex-col gap-1 bg-slate-900/90 border border-violet-500/60 rounded px-1.5 py-1">
                    <div className="ed-fs-xs font-mono uppercase tracking-wider text-violet-300 font-bold">
                      Guarda nesta Curva
                    </div>
                    <div className="grid grid-cols-5 gap-0.5">
                      {([
                        ['auto', 'Auto', 'Seguir a definição geral da estrada'],
                        ['none', 'Off', 'Sem guarda metálica neste ponto/curva'],
                        ['left', 'Esq.', 'Guarda metálica no lado esquerdo desta curva'],
                        ['right', 'Dir.', 'Guarda metálica no lado direito desta curva'],
                        ['both', 'Ambos', 'Guarda metálica em ambos os lados desta curva'],
                      ] as Array<[RoadPointGuardrail, string, string]>).map(([mode, lbl, tip]) => (
                        <button
                          key={mode}
                          data-testid={`btn-point-guardrail-${mode}`}
                          onClick={() => { const ed = getEditorScene(); if (ed) ed.setPointGuardrail(mode); }}
                          title={tip}
                          className={`ed-fs-xs font-bold py-1 px-0.5 rounded border text-center transition ${
                            roadUI.pointGuardrail === mode
                              ? 'bg-violet-400 text-black border-violet-200'
                              : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {roadUI.drawing && (
                  <>
                    <button onClick={() => { const ed = getEditorScene(); if (ed) ed.removeLastPendingPoint(); }} className="shrink-0 ed-fs font-bold bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 px-2 py-1 rounded">Retroceder Ponto</button>
                    <button onClick={() => { const ed = getEditorScene(); if (ed) ed.finishPendingRoad(); }} className="shrink-0 ed-fs font-bold bg-emerald-500 text-black border border-emerald-300 hover:bg-emerald-400 px-2 py-1 rounded">Terminar</button>
                    <div className="shrink-0 ed-fs-sm text-emerald-300/90 px-1 leading-tight">
                      Toca no último ponto (✓) ou botão direito p/ terminar · Arrasta pontos p/ ajustar
                    </div>
                  </>
                )}
                <button
                  data-testid="btn-road-snap-toggle"
                  onClick={() => { const ed = getEditorScene(); if (ed) ed.toggleRoadSnap(); }}
                  className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border transition text-left ${
                    roadUI.snapToRoads
                      ? 'bg-emerald-500 text-black border-emerald-300'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                  title="Colar automaticamente pontas, eixos em T e alinhamentos retos ao desenhar/arrastar (Shift desativa temporariamente)"
                >
                  {roadUI.snapToRoads ? '🧲 Colar Auto: ON' : '🧲 Colar Auto: OFF'}
                </button>
                {roadUI.hasSelection && !roadUI.drawing && (
                  <>
                    <button
                      data-testid="btn-road-isolate-toggle"
                      onClick={() => { const ed = getEditorScene(); if (ed) ed.toggleIsolateRoad(); }}
                      className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border transition text-left ${
                        roadUI.isolateSelectedRoad
                          ? 'bg-amber-400 text-black border-amber-200 shadow-md shadow-amber-500/20'
                          : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                      }`}
                      title="Bloqueia a edição apenas a esta estrada para evitar interferir com secções vizinhas"
                    >
                      {roadUI.isolateSelectedRoad ? '🔒 Edição Isolada' : '🔓 Isolar Estrada'}
                    </button>
                    {roadUI.overlapCount > 1 && (
                      <button
                        data-testid="btn-road-cycle-overlap"
                        onClick={() => { const ed = getEditorScene(); if (ed) ed.cycleOverlappingRoad(); }}
                        className="shrink-0 ed-fs font-bold bg-sky-950/80 text-sky-300 border border-sky-500/50 hover:bg-sky-900 px-2 py-1 rounded text-left"
                        title="Alterna entre estradas sobrepostas ou muito próximas no ponto selecionado"
                      >
                        ⇄ Alternar ({roadUI.overlapIndex + 1}/{roadUI.overlapCount})
                      </button>
                    )}
                    <button
                      data-testid="btn-road-weld"
                      disabled={!roadUI.canWeld}
                      onClick={() => {
                        const ed = getEditorScene();
                        if (ed) {
                          const r = ed.weldSelectedRoadEnds();
                          if (r.snappedCount > 0) addToast('Pontas coladas e alinhadas', 'success', 2200);
                        }
                      }}
                      className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border transition text-left ${
                        roadUI.canWeld
                          ? 'bg-cyan-500 text-black border-cyan-300 hover:bg-cyan-400'
                          : 'bg-slate-900/50 text-slate-600 border-slate-800/60 cursor-not-allowed'
                      }`}
                      title="Cola automaticamente as pontas abertas às estradas vizinhas (posição, largura e tangente)"
                    >
                      🧲 Colar Pontas
                    </button>
                    {roadUI.canMerge && (
                      <button
                        data-testid="btn-road-merge"
                        onClick={() => {
                          const ed = getEditorScene();
                          if (ed && ed.mergeSelectedWithAdjacent()) {
                            addToast('Secções fundidas numa única estrada', 'success', 2500);
                          }
                        }}
                        className="shrink-0 ed-fs font-bold bg-violet-500 text-black border border-violet-300 hover:bg-violet-400 px-2 py-1 rounded text-left"
                        title="Funde esta estrada com a secção adjacente compatível eliminando a emenda"
                      >
                        🔗 Fundir Secções
                      </button>
                    )}
                    <button onClick={() => { const ed = getEditorScene(); if (ed) ed.deleteSelectedRoad(); }} className="shrink-0 ed-fs font-bold bg-red-500 text-white border border-red-300 hover:bg-red-400 px-2 py-1 rounded text-left">Apagar Selecionada</button>
                  </>
                )}
                {roadUI.hasSelection === false && (
                  <>
                    <div className="shrink-0 h-px bg-slate-800 mx-1" />
                    <Lamp className="ed-icon text-slate-400 shrink-0" />
                    <span className="ed-fs-lg font-bold text-slate-400 shrink-0">cruzamentos detectados automaticamente</span>
                  </>
                )}
                {roadUI.hasSelection === false && (
                  <>
                    {(() => {
                      const ed = getEditorScene();
                      const intUI = ed ? ed.getIntersectionUIState() : null;
                      if (!intUI) return null;
                      return (
                        <>
                          <div className="shrink-0 h-px bg-amber-500/40 mx-1" />
                          <span className="ed-fs font-bold text-amber-300 shrink-0">
                            CRUZAMENTO {intUI.armCount} braços · {intUI.phaseCount} fase{intUI.phaseCount !== 1 ? 's' : ''} · camada {intUI.layer}
                          </span>
                          <div className="grid grid-cols-2 gap-1 shrink-0">
                            {([
                              ['none', 'Livre'],
                              ['signal', 'Semáforos'],
                              ['stop', 'STOP'],
                              ['yield', 'Cedência'],
                            ] as const).map(([mode, label]) => {
                              const active = intUI.controlType === mode;
                              return (
                                <button
                                  key={mode}
                                  onClick={() => { const ed = getEditorScene(); if (ed) ed.setIntersectionControl(mode); }}
                                  className={`ed-fs font-bold px-2 py-1 rounded border transition ${
                                    active
                                      ? mode === 'signal'
                                        ? 'bg-amber-400 text-slate-900 border-amber-200 shadow-md shadow-amber-500/30'
                                        : mode === 'stop'
                                          ? 'bg-red-500 text-white border-red-300 shadow-md shadow-red-500/30'
                                          : mode === 'yield'
                                            ? 'bg-orange-400 text-slate-900 border-orange-200 shadow-md shadow-orange-500/30'
                                            : 'bg-slate-700 text-white border-slate-500'
                                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                                  }`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                          <span className="ed-fs text-slate-500 shrink-0">
                            {intUI.controlType === 'signal'
                              ? 'semáforos + linha de paragem e STOP'
                              : intUI.controlType === 'stop'
                                ? 'placas STOP + linha de paragem e STOP'
                                : intUI.controlType === 'yield'
                                  ? 'cedência + linha descontínua e triângulo'
                                  : 'sem sinalização automática'}
                          </span>
                        </>
                      );
                    })()}
                  </>
                )}
                <div className="ed-fs-sm text-slate-500 px-1 pt-0.5 shrink-0">clica no mapa para desenhar</div>
              </div>
            )}
            {/* FLYOUT — submenu da ferramenta Objectos (duplicar/copiar/colar/apagar + tipo de atrelado do pad selecionado) */}
            {editorTool === 'object' && (
              <div
                className="absolute top-2 left-[74px] md:left-[90px] z-40 w-48 sm:w-52 md:w-56 max-w-[calc(100vw-4.5rem)] max-h-[calc(100dvh-9rem)] overflow-y-auto overflow-x-hidden no-scrollbar overscroll-contain touch-pan-y bg-slate-950/95 border border-amber-400/60 rounded-xl shadow-2xl py-1.5 px-1.5 flex flex-col gap-1"
              >
                <div className="ed-fs-sm font-mono uppercase tracking-wider text-amber-300 px-1 pb-0.5 font-bold shrink-0">OBJECTOS</div>
                <button
                  onClick={() => { const ed = getEditorScene(); if (ed) ed.toggleRotationSnap(); }}
                  className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border transition text-left ${
                    objectUI.rotationSnap
                      ? 'bg-amber-400 text-black border-amber-200 shadow-md shadow-amber-500/30'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                  }`}
                  title="Snap da rotação a múltiplos de 45° (Shift+S)"
                >
                  <RotateCcw className="w-3 h-3" /> Snap {objectUI.rotationSnap ? 'ON' : 'OFF'}
                </button>
                {objectUI.hasSelection ? (
                  <>
                    <span className="ed-fs-lg font-bold text-amber-300 whitespace-nowrap shrink-0">
                      OBJECTO: {objectUI.type} · {objectUI.angleDeg}°
                    </span>
                    <button
                      onClick={() => { const ed = getEditorScene(); if (ed) ed.duplicateSelectedObject(); }}
                      className="shrink-0 ed-fs font-bold bg-violet-500 text-black border border-violet-300 hover:bg-violet-400 px-2 py-1 rounded flex items-center gap-1 text-left"
                      title="Duplicar o objecto selecionado ao lado (Ctrl+D)"
                    >
                      <CopyPlus className="w-3 h-3" /> Duplicar
                    </button>
                    <button
                      onClick={() => { const ed = getEditorScene(); if (ed) ed.copySelectedObject(); }}
                      className="shrink-0 ed-fs font-bold bg-slate-900 text-slate-200 border border-slate-700 hover:bg-slate-800 px-2 py-1 rounded flex items-center gap-1 text-left"
                      title="Copiar o objecto selecionado para a prancheta do editor (Ctrl+C)"
                    >
                      <Copy className="w-3 h-3" /> Copiar
                    </button>
                    <button
                      onClick={() => { const ed = getEditorScene(); if (ed) ed.pasteClipboard(); }}
                      disabled={!objectUI.canPaste}
                      className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border flex items-center gap-1 text-left ${
                        objectUI.canPaste
                          ? 'bg-slate-900 text-slate-200 border-slate-700 hover:bg-slate-800'
                          : 'bg-slate-900/50 text-slate-600 border-slate-800 cursor-not-allowed'
                      }`}
                      title={objectUI.canPaste ? 'Colar o objecto copiado na posição do rato (Ctrl+V)' : 'Copia primeiro um objecto (Ctrl+C)'}
                    >
                      <ClipboardPaste className="w-3 h-3" /> Colar
                    </button>
                    <button
                      onClick={() => { const ed = getEditorScene(); if (ed) ed.undo(); }}
                      disabled={!objectUI.canUndo}
                      className={`shrink-0 ed-fs font-bold px-2 py-1 rounded border flex items-center gap-1 text-left ${
                        objectUI.canUndo
                          ? 'bg-slate-900 text-slate-200 border-slate-700 hover:bg-slate-800'
                          : 'bg-slate-900/50 text-slate-600 border-slate-800 cursor-not-allowed'
                      }`}
                      title={objectUI.canUndo ? 'Desfazer a última operação sobre objectos (Ctrl+Z)' : 'Não há nada para desfazer'}
                    >
                      <Undo className="w-3 h-3" /> Desfazer
                    </button>
                    <button
                      onClick={() => { const ed = getEditorScene(); if (ed) ed.deleteSelectedObject(); }}
                      className="shrink-0 ed-fs font-bold bg-red-500 text-white border border-red-300 hover:bg-red-400 px-2 py-1 rounded text-left"
                    >
                      Apagar
                    </button>
                    {objectUI.isCompound ? (
                      <>
                        <div className="ed-fs-sm font-bold text-slate-500 px-1 pt-0.5 shrink-0">COMPOSTO ({objectUI.compoundPartCount} partes)</div>
                        <button
                          onClick={() => { const ed = getEditorScene(); if (ed) ed.duplicateCompoundAsVariation(); }}
                          className="shrink-0 ed-fs font-bold bg-violet-500 text-black border border-violet-300 hover:bg-violet-400 px-2 py-1 rounded flex items-center gap-1 text-left"
                          title="Criar uma variação deste composto (não altera o original)"
                        >
                          <CopyPlus className="w-3 h-3" /> Variação
                        </button>
                        <button
                          onClick={() => { const ed = getEditorScene(); if (ed) { ed.ungroupCompound(); } }}
                          className="shrink-0 ed-fs font-bold bg-slate-900 text-slate-200 border border-slate-700 hover:bg-slate-800 px-2 py-1 rounded text-left"
                          title="Desagrupar (remove o composto, devolve as partes ao mapa como objectos soltos)"
                        >
                          Desagrupar
                        </button>
                        <span className="ed-fs text-slate-400 shrink-0">
                          para juntar mais objectos ou extrair partes usa a ferramenta Composto
                        </span>
                      </>
                    ) : null}
                    {objectUI.type === 'parking_pad' ? (
                      <>
                        <div className="ed-fs-sm font-bold text-slate-500 px-1 pt-0.5 shrink-0">estilo visual da baía</div>
                        <div className="grid grid-cols-2 gap-1 shrink-0">
                          {([
                            ['Asfalto', 'asphalt'],
                            ['Betão', 'concrete'],
                            ['Segurança', 'hazard'],
                            ['Moderna', 'clean'],
                          ] as Array<[string, string]>).map(([lbl, val]) => (
                            <button
                              key={val}
                              onClick={() => { const ed = getEditorScene(); if (ed) ed.setParkingPadVariant(objectUI.id, val); }}
                              className={`shrink-0 ed-fs font-bold px-1.5 py-1 rounded border text-left truncate ${
                                (objectUI.variant || 'asphalt') === val
                                  ? 'bg-amber-400 text-slate-900 border-amber-200'
                                  : 'bg-slate-800 text-amber-300 border-slate-600 hover:bg-slate-700'
                              }`}
                            >
                              {lbl}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {objectUI.type === 'gas_canopy' && objectUI.gasCanopy ? (
                      <>
                        <div className="ed-fs-sm font-bold text-slate-500 px-1 pt-0.5 shrink-0">tipo de posto</div>
                        <div className="grid grid-cols-2 gap-1 shrink-0">
                          {([
                            ['Autoestrada', 'highway'],
                            ['Secundário 1B', 'secondary'],
                          ] as Array<[string, 'highway' | 'secondary']>).map(([lbl, val]) => (
                            <button
                              key={val}
                              onClick={() => {
                                const ed = getEditorScene();
                                if (ed) {
                                  ed.setGasCanopyConfig(objectUI.id, { stationStyle: val });
                                  setObjectUI(ed.getObjectUIState());
                                }
                              }}
                              className={`shrink-0 ed-fs font-bold px-1.5 py-1 rounded border text-left truncate ${
                                objectUI.gasCanopy?.stationStyle === val
                                  ? 'bg-emerald-400 text-slate-950 border-emerald-200'
                                  : 'bg-slate-800 text-emerald-300 border-slate-600 hover:bg-slate-700'
                              }`}
                            >
                              {lbl}
                            </button>
                          ))}
                        </div>
                        <div className="ed-fs-sm font-bold text-slate-500 px-1 pt-0.5 shrink-0">lado da estrada</div>
                        <div className="grid grid-cols-2 gap-1 shrink-0">
                          {([
                            ['Direita', 'right'],
                            ['Esquerda', 'left'],
                            ['Acima', 'top'],
                            ['Abaixo', 'bottom'],
                            ['Passante', 'through'],
                          ] as Array<[string, 'right' | 'left' | 'top' | 'bottom' | 'through']>).map(([lbl, val]) => (
                            <button
                              key={val}
                              onClick={() => {
                                const ed = getEditorScene();
                                if (ed) {
                                  ed.setGasCanopyConfig(objectUI.id, { accessSide: val });
                                  setObjectUI(ed.getObjectUIState());
                                }
                              }}
                              className={`shrink-0 ed-fs font-bold px-1.5 py-1 rounded border text-left truncate ${
                                objectUI.gasCanopy?.accessSide === val
                                  ? 'bg-amber-400 text-slate-950 border-amber-200'
                                  : 'bg-slate-800 text-amber-300 border-slate-600 hover:bg-slate-700'
                              }`}
                            >
                              {lbl}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {objectUI.type === 'building' && objectUI.buildingFeatures ? (
                      <>
                        {objectUI.buildingFeatures.supportsGarage ? (
                          <>
                            <div className="ed-fs-sm font-bold text-slate-500 px-1 pt-0.5 shrink-0">acesso a garagem</div>
                            <div className="grid grid-cols-2 gap-1 shrink-0">
                              {([
                                ['Sem', false],
                                ['Com', true],
                              ] as Array<[string, boolean]>).map(([lbl, val]) => (
                                <button
                                  key={lbl}
                                  onClick={() => {
                                    const ed = getEditorScene();
                                    if (ed) {
                                      ed.setBuildingFeatures(objectUI.id, { garageAccess: val });
                                      setObjectUI(ed.getObjectUIState());
                                    }
                                  }}
                                  className={`shrink-0 ed-fs font-bold px-1.5 py-1 rounded border text-center ${
                                    objectUI.buildingFeatures?.garageAccess === val
                                      ? 'bg-emerald-400 text-slate-950 border-emerald-200'
                                      : 'bg-slate-800 text-emerald-300 border-slate-600 hover:bg-slate-700'
                                  }`}
                                >
                                  {lbl}
                                </button>
                              ))}
                            </div>
                          </>
                        ) : null}
                        {objectUI.buildingFeatures.supportsParking ? (
                          <>
                            <div className="ed-fs-sm font-bold text-slate-500 px-1 pt-0.5 shrink-0">estacionamento exterior</div>
                            <div className="grid grid-cols-2 gap-1 shrink-0">
                              {([
                                ['Sem', false],
                                ['Com', true],
                              ] as Array<[string, boolean]>).map(([lbl, val]) => (
                                <button
                                  key={lbl}
                                  onClick={() => {
                                    const ed = getEditorScene();
                                    if (ed) {
                                      ed.setBuildingFeatures(objectUI.id, { exteriorParking: val });
                                      setObjectUI(ed.getObjectUIState());
                                    }
                                  }}
                                  className={`shrink-0 ed-fs font-bold px-1.5 py-1 rounded border text-center ${
                                    objectUI.buildingFeatures?.exteriorParking === val
                                      ? 'bg-amber-400 text-slate-950 border-amber-200'
                                      : 'bg-slate-800 text-amber-300 border-slate-600 hover:bg-slate-700'
                                  }`}
                                >
                                  {lbl}
                                </button>
                              ))}
                            </div>
                          </>
                        ) : null}
                      </>
                    ) : null}
                    {objectUI.type === 'trailer' ? (
                      <>
                        <div className="ed-fs-sm font-bold text-slate-500 px-1 pt-0.5 shrink-0">tipo de atrelado</div>
                        <div className="grid grid-cols-2 gap-1 shrink-0">
                          {([
                            ['C · Std', 'standard'],
                            ['C · Frigo', 'reefer'],
                            ['C · ISO', 'container'],
                            ['C · Leite', 'tanker_milk'],
                            ['CE · Eólica', 'long_cargo'],
                            ['CE · Prancha', 'flatbed_heavy'],
                            ['CE · Toros', 'timber'],
                            ['CE · Petrol.', 'tanker_fuel'],
                            ['H · Bitrem', 'bitrem_lead'],
                            ['H · B.Trás', 'bitrem_pup'],
                            ['H · B.Cist', 'bitrem_tanker_lead'],
                            ['H · B.C.Tr', 'bitrem_tanker_pup'],
                            ['X · Vidro', 'fragile_glass'],
                            ['X · ADR', 'tanker_hazmat'],
                          ] as Array<[string, string]>).map(([lbl, val]) => (
                            <button
                              key={val}
                              onClick={() => { const ed = getEditorScene(); if (ed) ed.setTrailerPadType(objectUI.id, val); }}
                              className={`shrink-0 ed-fs font-bold px-1.5 py-1 rounded border text-left truncate ${
                                objectUI.trailer === val
                                  ? 'bg-amber-400 text-slate-900 border-amber-200'
                                  : 'bg-slate-800 text-amber-300 border-slate-600 hover:bg-slate-700'
                              }`}
                            >
                              {lbl}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {objectUI.type === 'hub_sign' && objectUI.hubSign ? (
                      <div
                        data-testid="hub-sign-inspector"
                        className="mt-1 pt-1.5 border-t border-slate-800 flex flex-col gap-1.5 shrink-0"
                      >
                        <div className="flex items-center justify-between gap-1 px-0.5">
                          <span className="ed-fs-sm font-mono font-bold uppercase tracking-wider text-cyan-300">
                            SINAL DE HUB
                          </span>
                          <span className="text-[9px] font-mono text-slate-400 truncate">
                            {objectUI.hubSign.isCustom ? 'Personalizado' : 'Oficial'}
                          </span>
                        </div>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-slate-400">Nome do HUB</span>
                          <input
                            type="text"
                            data-testid="hub-sign-name-input"
                            value={objectUI.hubSign.name}
                            maxLength={32}
                            onChange={(e) => {
                              const ed = getEditorScene();
                              if (!ed) return;
                              ed.updateHubSignParams(objectUI.id, { name: e.target.value });
                              setObjectUI(ed.getObjectUIState());
                            }}
                            className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-cyan-400"
                          />
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-slate-400">Sigla (Badge)</span>
                          <input
                            type="text"
                            data-testid="hub-sign-badge-input"
                            value={objectUI.hubSign.badge}
                            maxLength={8}
                            onChange={(e) => {
                              const ed = getEditorScene();
                              if (!ed) return;
                              ed.updateHubSignParams(objectUI.id, { badge: e.target.value });
                              setObjectUI(ed.getObjectUIState());
                            }}
                            className="w-full px-1.5 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] font-mono uppercase text-white focus:outline-none focus:border-cyan-400"
                          />
                        </label>
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] text-slate-400">Cor do HUB</span>
                          <div className="grid grid-cols-4 gap-1">
                            {[
                              '#06b6d4',
                              '#10b981',
                              '#f97316',
                              '#eab308',
                              '#ec4899',
                              '#a855f7',
                              '#3b82f6',
                              '#ef4444',
                            ].map((hex) => (
                              <button
                                key={hex}
                                type="button"
                                onClick={() => {
                                  const ed = getEditorScene();
                                  if (!ed) return;
                                  ed.updateHubSignParams(objectUI.id, { color: hex });
                                  setObjectUI(ed.getObjectUIState());
                                }}
                                aria-label={`Cor ${hex}`}
                                className={`h-5 rounded border transition ${
                                  objectUI.hubSign?.color.toLowerCase() === hex
                                    ? 'border-white scale-105 ring-1 ring-white/70'
                                    : 'border-slate-700 opacity-80 hover:opacity-100'
                                }`}
                                style={{ backgroundColor: hex }}
                              />
                            ))}
                          </div>
                        </div>
                        <label className="flex flex-col gap-0.5">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span>Raio de cobertura</span>
                            <span className="font-mono text-cyan-300">
                              {(objectUI.hubSign.regionRadius / 1000).toFixed(1)} km
                            </span>
                          </div>
                          <input
                            type="range"
                            min={600}
                            max={5000}
                            step={100}
                            value={objectUI.hubSign.regionRadius}
                            onChange={(e) => {
                              const ed = getEditorScene();
                              if (!ed) return;
                              ed.updateHubSignParams(objectUI.id, { regionRadius: Number(e.target.value) });
                              setObjectUI(ed.getObjectUIState());
                            }}
                            className="w-full accent-cyan-400"
                          />
                        </label>
                        <div className="bg-slate-900/80 border border-slate-800 rounded p-1.5 text-[10px] font-mono space-y-0.5">
                          <div className="flex justify-between text-slate-300">
                            <span>Docas associadas:</span>
                            <span className={objectUI.hubSign.docks > 0 ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                              {objectUI.hubSign.docks}
                            </span>
                          </div>
                          <div className="flex justify-between text-slate-300">
                            <span>Baías (Atrelados):</span>
                            <span className="text-slate-100">{objectUI.hubSign.parkingPads}</span>
                          </div>
                          <div className="flex justify-between text-slate-300">
                            <span>Oficinas:</span>
                            <span className="text-slate-100">{objectUI.hubSign.garages}</span>
                          </div>
                          {objectUI.hubSign.docks === 0 && (
                            <div className="pt-1 text-[9px] font-sans text-amber-300 leading-tight">
                              Adiciona pelo menos 1 Doca dentro do círculo para permitir entregas neste HUB.
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          data-testid="btn-hub-sign-missions"
                          onClick={() => {
                            setMissionEditorHubId(objectUI.hubSign?.hubId ?? null);
                            setShowMissionEditorModal(true);
                          }}
                          className="w-full py-1.5 px-2 rounded bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-200 ed-fs font-bold flex items-center justify-center gap-1 transition"
                        >
                          <ClipboardList className="w-3 h-3" />
                          Missões deste HUB
                        </button>
                      </div>
                    ) : null}
                    <span className="ed-fs text-slate-400 shrink-0 hidden lg:inline">
                      arrasta = mover · pega rosa = rodar livre{objectUI.resizable ? ' · quadrados brancos = redimensionar' : ''} · Ctrl+D duplica · Ctrl+C/V copia e cola
                    </span>
                  </>
                ) : (
                  <>
                    <span className="ed-fs-lg font-bold text-amber-300 whitespace-nowrap shrink-0">OBJECTOS</span>
                    <span className="ed-fs text-slate-400 shrink-0 hidden lg:inline">clica num objecto para selecionar</span>
                  </>
                )}
                <div className="ed-fs-sm text-slate-500 px-1 pt-0.5 shrink-0">Del apaga · Ctrl+D duplica · Ctrl+C/V copia e cola · Shift+S snap rotação 45°</div>
              </div>
            )}
            {/* FLYOUT — ferramenta Composto (marquee) */}
            {editorTool === 'compound' && (
              <div
                className="absolute top-2 left-[74px] md:left-[90px] z-40 w-48 sm:w-52 md:w-56 max-w-[calc(100vw-4.5rem)] max-h-[calc(100dvh-9rem)] overflow-y-auto overflow-x-hidden no-scrollbar overscroll-contain touch-pan-y bg-slate-950/95 border border-violet-400/60 rounded-xl shadow-2xl py-1.5 px-1.5 flex flex-col gap-1"
              >
                <div className="ed-fs-sm font-mono uppercase tracking-wider text-violet-300 px-1 pb-0.5 font-bold shrink-0">COMPOSTO</div>
                {(() => {
                  const ed = getEditorScene();
                  const sel = ed?.selectedObject ?? null;
                  const parts = sel && sel.type === 'compound' ? compoundParts(sel) : [];
                  if (sel && sel.type === 'compound') {
                    return (
                      <>
                        <span className="ed-fs-lg font-bold text-violet-300 whitespace-nowrap shrink-0">
                          COMPOSTO · {parts.length} partes
                        </span>
                        <span className="ed-fs text-slate-400 shrink-0">
                          arrasta outro rectângulo à volta de objectos no mapa para ACRESCENTÁ-LOS a este composto
                        </span>
                        <button
                          onClick={() => { if (ed) ed.duplicateCompoundAsVariation(); }}
                          className="shrink-0 ed-fs font-bold bg-violet-500 text-black border border-violet-300 hover:bg-violet-400 px-2 py-1 rounded flex items-center gap-1 text-left"
                          title="Criar uma variação deste composto (não altera o original)"
                        >
                          <CopyPlus className="w-3 h-3" /> Variação
                        </button>
                        <button
                          onClick={() => { if (ed) { ed.ungroupCompound(); } }}
                          className="shrink-0 ed-fs font-bold bg-slate-900 text-slate-200 border border-slate-700 hover:bg-slate-800 px-2 py-1 rounded text-left"
                          title="Desagrupar: devolve todas as partes ao mapa como objectos soltos"
                        >
                          Desagrupar
                        </button>
                        <div className="ed-fs-sm font-bold text-slate-500 px-1 pt-0.5 shrink-0">PARTES — × devolve ao mapa</div>
                        {parts.map((part, i) => (
                          <button
                            key={i}
                            onClick={() => { if (ed) ed.extractCompoundPart(i); }}
                            className="shrink-0 ed-fs font-bold bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30 px-2 py-1 rounded text-left"
                            title="Extrair esta parte do composto e devolvê-la ao mapa como objecto solto"
                          >
                            ⨯ {i + 1}: {part.type} ({Math.round(part.w)}×{Math.round(part.h)})
                          </button>
                        ))}
                      </>
                    );
                  }
                  return (
                    <>
                      <span className="ed-fs text-slate-300 shrink-0">
                        1. coloca no mapa os objectos que queres agrupar
                      </span>
                      <span className="ed-fs text-slate-300 shrink-0">
                        2. arrasta um rectângulo à volta deles — tudo o que ficar dentro torna-se UM objecto composto
                      </span>
                      <span className="ed-fs text-slate-400 shrink-0">
                        clica num composto para o selecionar · atrelados e compostos existentes nunca são capturados
                      </span>
                    </>
                  );
                })()}
              </div>
            )}
            {/* FLYOUT — submenu da ferramenta Mover (Pan) */}
            {editorTool === 'pan' && (
              <div
                className="absolute top-2 left-[74px] md:left-[90px] z-40 w-48 sm:w-52 md:w-56 max-w-[calc(100vw-4.5rem)] max-h-[calc(100dvh-9rem)] overflow-y-auto overflow-x-hidden no-scrollbar overscroll-contain touch-pan-y bg-slate-950/95 border border-cyan-400/60 rounded-xl shadow-2xl py-1.5 px-1.5 flex flex-col gap-1"
              >
                <div className="ed-fs-sm font-mono uppercase tracking-wider text-cyan-300 px-1 pb-0.5 font-bold shrink-0">MOVER</div>
                <Hand className="ed-icon text-cyan-400 shrink-0 animate-bounce" />
                <span className="ed-fs-lg font-bold text-cyan-300 shrink-0">
                  Arrasta (rato/botão do meio/2 dedos) — funciona sempre, em qualquer ferramenta
                </span>
                <div className="ed-fs-sm text-slate-500 px-1 pt-0.5 shrink-0">zoom com a roda do rato · dois dedos para panoramizar</div>
              </div>
            )}
            {/* FLYOUT — submenu da ferramenta Spawn Point */}
            {editorTool === 'spawn' && (
              <div
                className="absolute top-2 left-[74px] md:left-[90px] z-40 w-48 sm:w-52 md:w-56 max-w-[calc(100vw-4.5rem)] max-h-[calc(100dvh-9rem)] overflow-y-auto overflow-x-hidden no-scrollbar overscroll-contain touch-pan-y bg-slate-950/95 border border-emerald-400/60 rounded-xl shadow-2xl py-1.5 px-1.5 flex flex-col gap-1"
              >
                <div className="ed-fs-sm font-mono uppercase tracking-wider text-emerald-300 px-1 pb-0.5 font-bold shrink-0">SPAWN</div>
                <Compass className="ed-icon text-emerald-400 shrink-0 animate-spin" />
                <span className="ed-fs-lg font-bold text-emerald-300 shrink-0">
                  Clica no mapa para definir o ponto de partida do camião
                </span>
              </div>
            )}
          </aside>
        </>
      )}

      {/* LICENSE SYSTEM MODAL */}
      {showLicenseModal && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[60] flex items-center justify-center p-2 sm:p-4"
          onClick={() => setShowLicenseModal(false)}
        >
          <div
            className="bg-slate-950 border border-cyan-500/50 max-w-3xl w-full rounded-xl sm:rounded-2xl shadow-2xl p-3.5 sm:p-6 flex flex-col max-h-[92dvh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start sm:items-center justify-between gap-2.5 border-b border-slate-800 pb-3 sm:pb-4 mb-3 sm:mb-4 shrink-0">
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                <div className="p-1.5 sm:p-2 bg-cyan-500/20 text-cyan-400 rounded-lg border border-cyan-500/40 shrink-0">
                  <Award className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base sm:text-xl font-black text-white leading-snug">SISTEMA DE LICENÇAS</h2>
                  <p className="text-[11px] sm:text-xs text-slate-400">
                    Provas práticas de manobra para desbloqueio de veículos.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowLicenseModal(false)}
                aria-label="Fechar"
                className="text-slate-400 hover:text-white text-sm px-2 py-1 bg-slate-900 rounded shrink-0"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 overflow-y-auto overscroll-contain flex-1 min-h-0 pr-0.5 sm:pr-1">
              {licenses.map((lic) => {
                const isPassed = lic.unlocked;

                const badgeUrl = SpriteRegistry.getLicenseBadgeSprite(lic.id);

                return (
                  <div
                    key={lic.id}
                    className={`p-4 rounded-xl border flex flex-col justify-between transition ${
                      isPassed
                        ? 'bg-slate-900/60 border-cyan-500/40'
                        : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0 flex items-center justify-center">
                          <img
                            src={badgeUrl}
                            alt={`Emblema ${lic.name}`}
                            referrerPolicy="no-referrer"
                            className={`w-full h-full object-contain transition-all ${
                              isPassed
                                ? 'drop-shadow-[0_0_12px_rgba(34,211,238,0.3)]'
                                : 'opacity-70 grayscale-[35%]'
                            }`}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                            <span
                              className="px-2 py-0.5 rounded font-black text-xs font-mono"
                              style={{ backgroundColor: `${lic.color}22`, color: lic.color, border: `1px solid ${lic.color}66` }}
                            >
                              {lic.badge} • {lic.level}
                            </span>
                            {isPassed ? (
                              <span className="text-emerald-400 text-xs font-bold flex items-center gap-1">
                                <CheckCircle className="w-3.5 h-3.5" /> DESBLOQUEADA
                              </span>
                            ) : (
                              <span className="text-amber-400 text-xs font-bold flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5" /> EXAME PENDENTE
                              </span>
                            )}
                          </div>

                          <h3 className="font-bold text-sm text-white mb-0.5">{lic.name} - {lic.title}</h3>
                          <p className="text-xs text-slate-400">{lic.description}</p>
                        </div>
                      </div>

                      <div className="bg-slate-950 p-2.5 rounded border border-slate-850 mb-3 text-[11px] space-y-1">
                        <div className="text-slate-300 font-semibold">{lic.exam.title}</div>
                        <ul className="text-slate-400 list-disc list-inside space-y-0.5">
                          {lic.exam.instructions.map((ins, i) => (
                            <li key={i}>{ins}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <button
                      onClick={() => handleStartExam(lic.id)}
                      className={`w-full py-2 rounded text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                        isPassed
                          ? 'bg-slate-800 text-cyan-300 hover:bg-slate-700'
                          : 'bg-cyan-500 hover:bg-cyan-400 text-black font-black shadow-lg shadow-cyan-500/20'
                      }`}
                    >
                      <Play className="w-3.5 h-3.5" />
                      {isPassed ? 'Repetir Exame Prático' : 'Realizar Exame Prático'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 sm:mt-4 pt-3 border-t border-slate-800 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-[11px] sm:text-xs shrink-0">
              <span className="text-slate-400">Progressão por mestria pura, sem economia monetária.</span>
              <button
                onClick={() => LicenseSystem.getInstance().unlockAllLicenses()}
                className="text-cyan-400 hover:underline text-left sm:text-right font-medium"
              >
                Desbloquear Todas (Sandbox)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GARAGE & REGIONAL HUBS MODAL */}
      {showGarageModal && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[60] flex items-center justify-center p-2 sm:p-4"
          onClick={() => setShowGarageModal(false)}
        >
          <div
            className="bg-slate-950 border border-amber-500/50 max-w-3xl w-full rounded-xl sm:rounded-2xl shadow-2xl p-3.5 sm:p-6 flex flex-col max-h-[92dvh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start sm:items-center justify-between gap-2.5 border-b border-slate-800 pb-3 sm:pb-4 mb-3 sm:mb-4 shrink-0">
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                <div className="p-1.5 sm:p-2 bg-amber-500/20 text-amber-400 rounded-lg border border-amber-500/40 shrink-0">
                  <MapPin className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base sm:text-xl font-black text-white leading-snug">HUBS & GARAGENS</h2>
                  <p className="text-[11px] sm:text-xs text-slate-400">
                    Domina os hubs regionais para desbloquear modificadores de clima.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowGarageModal(false)}
                aria-label="Fechar"
                className="text-slate-400 hover:text-white text-sm px-2 py-1 bg-slate-900 rounded shrink-0"
              >
                ✕
              </button>
            </div>

            {/* Weather Modifier Quick Bar — wraps cleanly on narrow mobile screens */}
            <div className="bg-slate-900/80 p-2.5 sm:p-3 rounded-xl border border-slate-800 mb-3 sm:mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0">
              <div className="min-w-0">
                <div className="text-xs font-bold text-white">Modificadores de Ambiente</div>
                <div className="text-[11px] text-slate-400">
                  Dinâmico (frentes móveis e sombras de nuvens) ou clima fixo dos hubs.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  data-testid="btn-weather-dynamic"
                  onClick={handleSetDynamicWeather}
                  className={`px-2.5 sm:px-3 py-1 rounded text-[11px] sm:text-xs font-semibold transition whitespace-nowrap flex items-center gap-1 ${
                    activeWeather === 'clear' && weatherDynamic
                      ? 'bg-sky-400 text-slate-950 font-bold shadow-md shadow-sky-400/30'
                      : 'bg-slate-950 text-slate-300 hover:text-white border border-slate-800'
                  }`}
                >
                  <Cloud className="w-3 h-3" />
                  Dinâmico
                </button>
                {(['clear', 'rain', 'storm', 'fog', 'night'] as const).map((weather) => {
                  const unlocked = GarageSystem.getInstance().getUnlockedModifiers().includes(weather);
                  const isActive =
                    weather === 'clear'
                      ? activeWeather === 'clear' && !weatherDynamic
                      : activeWeather === weather;
                  return (
                    <button
                      key={weather}
                      data-testid={`btn-weather-${weather}`}
                      onClick={() => handleSetWeather(weather)}
                      disabled={!unlocked}
                      title={unlocked ? undefined : 'Bloqueado: domina o Hub correspondente a 100%'}
                      className={`px-2.5 sm:px-3 py-1 rounded text-[11px] sm:text-xs font-semibold capitalize transition whitespace-nowrap ${
                        isActive
                          ? weather === 'storm'
                            ? 'bg-indigo-400 text-slate-950 font-bold shadow-md shadow-indigo-400/30'
                            : 'bg-cyan-500 text-black font-bold shadow-md shadow-cyan-500/30'
                          : unlocked
                            ? 'bg-slate-950 text-slate-300 hover:text-white border border-slate-800'
                            : 'bg-slate-950 text-slate-600 border border-slate-900 cursor-not-allowed'
                      }`}
                    >
                      {weather === 'storm'
                        ? 'Trovoada'
                        : weather === 'rain'
                          ? 'Chuva'
                          : weather === 'fog'
                            ? 'Nevoeiro'
                            : weather === 'night'
                              ? 'Noturno'
                              : 'Limpo'}
                      {!unlocked && ' 🔒'}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="overflow-y-auto overscroll-contain flex-1 min-h-0 pr-0.5 sm:pr-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
              {hubs.map((hub) => {
                const bannerUrl = SpriteRegistry.getHubBanner(hub.id);
                return (
                <div
                  key={hub.id}
                  className={`rounded-xl border flex flex-col justify-between transition ${
                    hub.isDominant
                      ? 'bg-slate-900/80 border-amber-500/50 shadow-lg shadow-amber-500/10'
                      : 'bg-slate-950/80 border-slate-800'
                  }`}
                >
                  <div>
                    {bannerUrl ? (
                      <div className="relative h-28 sm:h-32 w-full rounded-t-xl overflow-hidden border-b border-slate-800/80">
                        <img
                          src={bannerUrl}
                          alt={hub.name}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          className="w-full h-full object-cover object-center"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/45 to-slate-950/15" />
                        <div className="absolute top-2.5 left-3 right-3 flex items-center justify-between gap-2">
                          <span
                            className="px-2 py-0.5 rounded font-black text-[11px] font-mono bg-slate-950/92"
                            style={{ color: hub.color, border: `1px solid ${hub.color}88` }}
                          >
                            {hub.badge} • HUB REGIONAL
                          </span>
                          {hub.isDominant ? (
                            <span className="px-2 py-0.5 rounded bg-slate-950/85 text-amber-400 text-[11px] font-black flex items-center gap-1 animate-pulse">
                              <Sparkles className="w-3 h-3" /> NÉON 100%
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-slate-950/80 text-slate-200 text-[11px] font-mono">
                              {hub.progress}% DOMINADO
                            </span>
                          )}
                        </div>
                        <div className="absolute bottom-2 left-3 right-3">
                          <h3 className="font-bold text-base text-white drop-shadow leading-tight">{hub.name}</h3>
                        </div>
                      </div>
                    ) : (
                      <div className="px-4 pt-4">
                        <div className="flex items-center justify-between mb-2">
                          <span
                            className="px-2 py-0.5 rounded font-black text-xs font-mono"
                            style={{ backgroundColor: `${hub.color}22`, color: hub.color, border: `1px solid ${hub.color}66` }}
                          >
                            {hub.badge} • HUB REGIONAL
                          </span>
                          {hub.isDominant ? (
                            <span className="text-amber-400 text-xs font-black flex items-center gap-1 animate-pulse">
                              <Sparkles className="w-3.5 h-3.5" /> SINAL NÉON ATIVO (100%)
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs font-mono">{hub.progress}% DOMINADO</span>
                          )}
                        </div>
                        <h3 className="font-bold text-base text-white mb-1">{hub.name}</h3>
                      </div>
                    )}

                    <div className="p-4 pt-3">
                      <p className="text-xs text-slate-400 mb-3">{hub.description}</p>

                      {/* Progress Bar */}
                      <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden mb-3 border border-slate-800">
                        <div
                          className="h-full transition-all"
                          style={{
                            width: `${hub.progress}%`,
                            backgroundColor: hub.color,
                          }}
                        />
                      </div>

                      {/* Regional Contracts */}
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-mono text-slate-300 font-semibold">Contratos Regionais:</div>
                        {hub.contracts.map((c) => (
                          <div
                            key={c.id}
                            className="flex items-center justify-between text-xs bg-slate-950 p-2 rounded border border-slate-850"
                          >
                            <div>
                              <div className="text-slate-200 font-medium">{c.title}</div>
                              <div className="text-[10px] text-slate-400">{c.cargoDescription}</div>
                            </div>
                            {c.completed ? (
                              <span className="text-emerald-400 text-[11px] font-bold">Concluído</span>
                            ) : (
                              <button
                                onClick={() => {
                                  GarageSystem.getInstance().completeContract(c.id);
                                  handleReset();
                                }}
                                className="text-[11px] bg-amber-500/20 text-amber-300 px-2 py-1 rounded border border-amber-500/50 hover:bg-amber-500 hover:text-black font-semibold"
                              >
                                Entregar (+{c.rewardProgress}%)
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="px-4 py-2.5 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                    <span>Desbloqueia: Peças de bioma + {hub.unlockedModifier}</span>
                    <button
                      onClick={() => GarageSystem.getInstance().addProgress(hub.id, 25)}
                      className="text-amber-400 hover:underline"
                    >
                      +25% Progresso
                    </button>
                  </div>
                </div>
                );
              })}
              </div>
            </div>

            <div className="mt-3 sm:mt-4 pt-3 border-t border-slate-800 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-[11px] sm:text-xs shrink-0">
              <span className="text-slate-400">Dominar a 100% ativa sinais néon no mapa e clima regional.</span>
              <button
                onClick={() => {
                  GarageSystem.getInstance().dominateAllHubs();
                  addToast('Todos os hubs dominados — sinais néon, biomas e meteorologia desbloqueados', 'success', 2800);
                }}
                className="text-amber-400 hover:underline text-left sm:text-right font-medium"
              >
                Dominar Todos (100% Instantâneo)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JSON EXPORT & IMPORT MODAL */}
      {showJsonModal && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[60] flex items-center justify-center p-2 sm:p-4"
          onClick={() => setShowJsonModal(false)}
        >
          <div
            className="bg-slate-950 border border-slate-700 max-w-2xl w-full rounded-xl sm:rounded-2xl shadow-2xl p-3.5 sm:p-6 flex flex-col max-h-[92dvh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-3 mb-2.5 sm:mb-3 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <FileCode className="w-5 h-5 text-cyan-400 shrink-0" />
                <h3 className="font-bold text-white text-sm sm:text-base truncate">Exportar / Importar Mapa JSON</h3>
              </div>
              <button
                onClick={() => setShowJsonModal(false)}
                aria-label="Fechar"
                className="text-slate-400 hover:text-white text-sm px-2 py-1 bg-slate-900 rounded shrink-0"
              >
                ✕
              </button>
            </div>

            {jsonError && (
              <div className="bg-red-950/80 border border-red-500 text-red-200 p-2 rounded text-xs mb-2.5 shrink-0">
                {jsonError}
              </div>
            )}

            <p className="text-[11px] sm:text-xs text-slate-400 mb-2 shrink-0">
              Edita diretamente ou cola os dados JSON do mapa. Podes descarregar ou copiar para partilha.
            </p>

            <textarea
              value={jsonContent}
              onChange={(e) => setJsonContent(e.target.value)}
              className="w-full flex-1 min-h-[180px] sm:min-h-[300px] bg-slate-900 text-cyan-300 font-mono text-xs p-2.5 sm:p-3 rounded border border-slate-800 focus:border-cyan-400 outline-none resize-none"
            />

            <div className="mt-3 sm:mt-4 pt-3 border-t border-slate-800 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 shrink-0">
              <div className="flex gap-2">
                <button
                  onClick={handleDownloadJSON}
                  className="flex-1 sm:flex-initial justify-center px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white flex items-center gap-1.5"
                >
                  <Download className="w-4 h-4" /> .json
                </button>
                <button
                  onClick={handleCopyJSON}
                  className="flex-1 sm:flex-initial justify-center px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-cyan-300 flex items-center gap-1.5"
                >
                  <Copy className="w-4 h-4" /> Copiar JSON
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowJsonModal(false)}
                  className="flex-1 sm:flex-initial px-4 py-2 rounded bg-slate-900 hover:bg-slate-800 text-xs text-slate-300"
                >
                  Fechar
                </button>
                <button
                  onClick={handleApplyImport}
                  className="flex-1 sm:flex-initial justify-center px-4 py-2 rounded bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-cyan-500/20"
                >
                  <Upload className="w-4 h-4" /> Aplicar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PHASE 3 PROGRESSION MODALS */}
      <MissionsModal
        open={showMissionsModal}
        onClose={() => setShowMissionsModal(false)}
        currentHubId={telemetry.currentHubId}
        activeTruckType={telemetry.activeTruckType}
        gameMode={telemetry.gameMode}
        activeMission={telemetry.activeMission}
        hubReputation={telemetry.hubReputation}
        onAcceptMission={handleAcceptMission}
        onCancelMission={handleCancelMission}
        onOpenWorldMap={() => {
          setMapFocusTruckId(null);
          setShowWorldMapModal(true);
        }}
      />

      <MissionEditorModal
        open={showMissionEditorModal}
        initialHubId={missionEditorHubId}
        onClose={() => setShowMissionEditorModal(false)}
        onWorldChanged={() => {
          const scene = getMainScene();
          if (scene?.world) {
            scene.world.version++;
          }
        }}
      />

      <FleetGarageModal
        open={showFleetModal}
        onClose={() => setShowFleetModal(false)}
        gameMode={telemetry.gameMode}
        activeTruckId={telemetry.activeTruckId}
        activeTruckPos={{
          x: getMainScene()?.truck?.body?.position?.x ?? 5760,
          y: getMainScene()?.truck?.body?.position?.y ?? 4700,
        }}
        speedKmh={telemetry.speedKmh}
        hubReputation={telemetry.hubReputation}
        onSwapTruck={handleSwapTruck}
        onOpenWorkshop={() => setShowWorkshopModal(true)}
        onOpenWorldMap={(focusId) => {
          setMapFocusTruckId(focusId ?? null);
          setShowWorldMapModal(true);
        }}
      />

      <WorkshopUpgradesModal
        open={showWorkshopModal}
        onClose={() => setShowWorkshopModal(false)}
        gameMode={telemetry.gameMode}
        activeTruckType={telemetry.activeTruckType}
        installedUpgrades={telemetry.activeTruckUpgrades}
        truckWear={telemetry.truckWear}
        brakeHeat={telemetry.brakeHeat}
        truckHealth={telemetry.truckHealth}
        inRepairBay={Boolean(telemetry.nearbyRepairBay)}
        speedKmh={telemetry.speedKmh}
        onInstallUpgrade={handleInstallUpgrade}
        onRepairNow={() => {
          const scene = getMainScene();
          if (scene) scene.tryRepair();
        }}
      />

      <WorldMapModal
        open={showWorldMapModal}
        onClose={() => setShowWorldMapModal(false)}
        scene={getMainScene()}
        gameMode={telemetry.gameMode}
        activeTruckId={telemetry.activeTruckId}
        activeTruckPos={{
          x: getMainScene()?.truck?.body?.position?.x ?? 5760,
          y: getMainScene()?.truck?.body?.position?.y ?? 4700,
          angle: getMainScene()?.truck?.body?.angle ?? 0,
        }}
        speedKmh={telemetry.speedKmh}
        hubReputation={telemetry.hubReputation}
        activeMission={telemetry.activeMission}
        missionNavTarget={telemetry.missionNavTarget}
        initialFocusTruckId={mapFocusTruckId}
        onSwapTruck={handleSwapTruck}
      />

      {/* TOASTS (coupling/mission feedback + persistent <=20% low-fuel reserve toaster; kept clear of Minimap & Mission Banner) */}
      {!isEditorMode && (
        <div
          className={`absolute ${
            telemetry.activeMission ? 'top-[132px] sm:top-[140px] lg:top-[132px]' : 'top-[58px]'
          } left-2 right-[134px] sm:right-[170px] lg:inset-x-0 z-40 flex flex-col items-start lg:items-center gap-1.5 pointer-events-none lg:px-4`}
        >
          {telemetry.fuelPercent <= 20 && !telemetry.isOutOfFuel && (
            <div className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border shadow-lg text-[11px] sm:text-xs font-bold bg-red-950/95 border-amber-400/90 text-amber-100 shadow-amber-500/30 animate-pulse">
              ⛽ Combustível na reserva ({Math.round(telemetry.fuelPercent)}% ≤ 20%) — abasteça numa bomba
            </div>
          )}
          {toasts.map((t) => (
            <div
              key={t.id}
              onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
              title="Toque para fechar"
              className={`pointer-events-auto cursor-pointer px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border shadow-lg text-[11px] sm:text-xs font-bold max-w-full lg:max-w-lg ${
                t.kind === 'fuel'
                  ? 'bg-red-950/95 border-red-400/80 text-red-100 shadow-red-500/30'
                  : t.kind === 'blocked'
                    ? 'bg-amber-950/90 border-amber-500/60 text-amber-200 shadow-amber-500/20'
                    : t.kind === 'success'
                      ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-200 shadow-emerald-500/20'
                      : 'bg-slate-900/90 border-cyan-500/50 text-cyan-100 shadow-cyan-500/20'
              }`}
            >
              {t.kind === 'fuel' ? '⛽ ' : t.kind === 'blocked' ? '🔒 ' : t.kind === 'success' ? '✅ ' : 'ℹ️ '}
              {t.text}
            </div>
          ))}
        </div>
      )}

      {/* TOUCH CONTROLS (STEERING WHEEL LEFT, THROTTLE & BRAKE RIGHT) */}
      <TouchControls
        visible={!isEditorMode && showTouchControls}
        coupling={telemetry.coupling}
        fuelPercent={telemetry.fuelPercent}
        fuelLevel={telemetry.fuelLevel}
        truckHealth={telemetry.truckHealth}
        trailerHealth={telemetry.trailerHealth}
        cargoHealth={telemetry.cargoHealth}
        nearbyRepairBay={telemetry.nearbyRepairBay}
        headlightMode={telemetry.headlightMode}
        autoHeadlights={telemetry.autoHeadlights}
        onToggleAutoLights={() => {
          const scene = getMainScene();
          if (scene?.truck) scene.truck.toggleAutoHeadlights();
        }}
        onToggleLowBeam={() => {
          const scene = getMainScene();
          if (scene?.truck) scene.truck.toggleLowBeam();
        }}
        onToggleHighBeam={() => {
          const scene = getMainScene();
          if (scene?.truck) scene.truck.toggleHighBeam();
        }}
        onDecouple={() => {
          const scene = getMainScene();
          if (scene) scene.decoupleAction();
        }}
        onRepair={() => {
          const scene = getMainScene();
          if (scene) scene.tryRepair();
        }}
      />
    </div>
  );
}
