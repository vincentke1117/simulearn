import type { ReactElement } from 'react'
import type { CircuitComponentType } from './components'

type IconProps = { size?: number }

function baseSvg(children: ReactElement | ReactElement[], size = 16) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function IconResistor({ size = 16 }: IconProps) {
  return baseSvg(
    <path d="M2 12h4l2-4 2 8 2-8 2 8 2-4h4" />, 
    size,
  )
}

export function IconCapacitor({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <path d="M2 12h7" />
      <path d="M15 12h7" />
      <path d="M9 6v12" />
      <path d="M15 6v12" />
    </>,
    size,
  )
}

export function IconInductor({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <path d="M2 12c2-4 6-4 8 0" />
      <path d="M10 12c2-4 6-4 8 0" />
      <path d="M18 12c2-4 6-4 8 0" />
    </>,
    size,
  )
}

export function IconVDC({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M10 9h4" />
      <path d="M12 7v4" />
      <path d="M10 15h4" />
    </>,
    size,
  )
}

export function IconVAC({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M6 12c2-3 4 3 6 0s4-3 6 0" />
    </>,
    size,
  )
}

export function IconGround({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <path d="M12 10v4" />
      <path d="M6 14h12" />
      <path d="M8 16h8" />
      <path d="M10 18h4" />
    </>,
    size,
  )
}

export function IconVProbe({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M9 12h6" />
      <path d="M12 9v6" />
    </>,
    size,
  )
}

export function IconIProbe({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 8v8" />
      <path d="M12 8l-2 2" />
      <path d="M12 8l2 2" />
    </>,
    size,
  )
}

// 直流电流源
export function IconIDC({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 8v8" />
      <path d="M12 16l-2-2" />
      <path d="M12 16l2-2" />
    </>,
    size,
  )
}

// 交流电流源
export function IconIAC({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M6 12c2-3 4 3 6 0s4-3 6 0" />
      <path d="M12 8l-2 2" />
      <path d="M12 8l2 2" />
    </>,
    size,
  )
}

// 电压控制电压源 (VCVS)
export function IconVCVS({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <path d="M3 12h5" />
      <path d="M16 12h5" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
      <path d="M10 10h4" />
      <path d="M12 8v2" />
      <path d="M10 14h4" />
    </>,
    size,
  )
}

// 电流控制电压源 (CCVS)
export function IconCCVS({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <path d="M3 12h5" />
      <path d="M16 12h5" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
      <path d="M10 10h4" />
      <path d="M12 8v2" />
      <path d="M10 14h4" />
      <circle cx="10" cy="12" r="1" fill="currentColor" />
      <circle cx="14" cy="12" r="1" fill="currentColor" />
    </>,
    size,
  )
}

// 电压控制电流源 (VCCS)
export function IconVCCS({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <path d="M3 12h5" />
      <path d="M16 12h5" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
      <path d="M12 10v4" />
      <path d="M12 14l-2-2" />
      <path d="M12 14l2-2" />
    </>,
    size,
  )
}

// 电流控制电流源 (CCCS)
export function IconCCCS({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <path d="M3 12h5" />
      <path d="M16 12h5" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
      <path d="M12 10v4" />
      <path d="M12 14l-2-2" />
      <path d="M12 14l2-2" />
      <circle cx="10" cy="10" r="1" fill="currentColor" />
      <circle cx="14" cy="10" r="1" fill="currentColor" />
    </>,
    size,
  )
}

export function IconSwitch({ size = 16, state = 0 }: IconProps & { state?: number }) {
  const isOpen = state === 0
  return baseSvg(
    <>
      <circle cx="8" cy="12" r="1.5" fill="currentColor" />
      <circle cx="16" cy="12" r="1.5" fill="currentColor" />
      <path d="M0 12h8" />
      <path d="M16 12h8" />
      {isOpen ? (
        <path d="M8 12l7-4" />
      ) : (
        <path d="M8 12h8" />
      )}
    </>,
    size,
  )
}

export function IconControlStep({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <path d="M3 17h18" />
      <path d="M6 17V9h8" />
      <path d="M14 9h4" />
    </>,
    size,
  )
}

export function IconControlConstant({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <path d="M4 12h16" />
      <path d="M4 8v8" />
      <path d="M20 8v8" />
    </>,
    size,
  )
}

export function IconControlSum({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M9 12h6" />
      <path d="M12 9v6" />
      <path d="M3 8h3" />
      <path d="M3 16h3" />
      <path d="M18 12h3" />
    </>,
    size,
  )
}

export function IconControlGain({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <path d="M4 12h5" />
      <path d="M15 12h5" />
      <path d="M9 7l6 5-6 5z" />
    </>,
    size,
  )
}

export function IconControlIntegrator({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 12h6" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
    </>,
    size,
  )
}

export function IconControlPlant1st({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <rect x="5" y="7" width="14" height="10" rx="2" />
      <path d="M3 12h2" />
      <path d="M19 12h2" />
      <path d="M8 12h8" />
      <path d="M12 9v6" />
    </>,
    size,
  )
}

export function IconControlPID({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="M7 10h2" />
      <path d="M11 10h2" />
      <path d="M15 10h2" />
      <path d="M7 14h10" />
    </>,
    size,
  )
}

export function IconControlScope({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M7 14l2-3 2 2 2-4 2 5" />
    </>,
    size,
  )
}

export function IconVoltageSensor({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 5v14" />
      <path d="M9 8h6" />
      <path d="M9 16h6" />
    </>,
    size,
  )
}

export function IconCurrentSensor({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M8 12h8" />
      <path d="M14 10l2 2-2 2" />
    </>,
    size,
  )
}

export function IconControlledVoltageSource({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M9 12h6" />
      <path d="M12 9v6" />
      <path d="M4 6l4 2" />
    </>,
    size,
  )
}

export function IconControlledCurrentSource({ size = 16 }: IconProps) {
  return baseSvg(
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 8v8" />
      <path d="M12 16l-2-2" />
      <path d="M12 16l2-2" />
      <path d="M4 6l4 2" />
    </>,
    size,
  )
}

export function ComponentIcon({ type, size = 16, parameters }: { type: CircuitComponentType; size?: number; parameters?: Record<string, number> }) {
  switch (type) {
    case 'control_step':
      return <IconControlStep size={size} />
    case 'control_constant':
      return <IconControlConstant size={size} />
    case 'control_sum':
      return <IconControlSum size={size} />
    case 'control_gain':
      return <IconControlGain size={size} />
    case 'control_integrator':
      return <IconControlIntegrator size={size} />
    case 'control_plant_1st':
      return <IconControlPlant1st size={size} />
    case 'control_pid':
      return <IconControlPID size={size} />
    case 'control_scope':
      return <IconControlScope size={size} />
    case 'voltage_sensor':
      return <IconVoltageSensor size={size} />
    case 'current_sensor':
      return <IconCurrentSensor size={size} />
    case 'controlled_voltage_source':
      return <IconControlledVoltageSource size={size} />
    case 'controlled_current_source':
      return <IconControlledCurrentSource size={size} />
    case 'switch':
      return <IconSwitch size={size} state={parameters?.state} />
    case 'resistor':
      return <IconResistor size={size} />
    case 'capacitor':
      return <IconCapacitor size={size} />
    case 'inductor':
      return <IconInductor size={size} />
    case 'vsource_dc':
      return <IconVDC size={size} />
    case 'vsource_ac':
      return <IconVAC size={size} />
    case 'isource_dc':
      return <IconIDC size={size} />
    case 'isource_ac':
      return <IconIAC size={size} />
    case 'vcvs':
      return <IconVCVS size={size} />
    case 'ccvs':
      return <IconCCVS size={size} />
    case 'vccs':
      return <IconVCCS size={size} />
    case 'cccs':
      return <IconCCCS size={size} />
    case 'ground':
      return <IconGround size={size} />
    case 'voltage_probe':
      return <IconVProbe size={size} />
    case 'current_probe':
      return <IconIProbe size={size} />
    default:
      return baseSvg(<circle cx="12" cy="12" r="6" />, size)
  }
}
