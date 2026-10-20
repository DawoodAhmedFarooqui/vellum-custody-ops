import ClearIcon from '@mui/icons-material/Clear'
import SearchIcon from '@mui/icons-material/Search'
import { Button, Checkbox, FormControl, InputAdornment, InputLabel, ListItemText, MenuItem, OutlinedInput, Select, Stack, TextField } from '@mui/material'
import { useEffect, useState } from 'react'
import { titleCase } from '../format.js'

// Multi-select filter. Options are strings or { value, label }.
export function MultiSelect({ label, value, options, onChange, width = 170 }) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: titleCase(o) } : o))
  const labelOf = (v) => opts.find((o) => String(o.value) === String(v))?.label ?? v
  return (
    <FormControl size="small" sx={{ minWidth: width }}>
      <InputLabel>{label}</InputLabel>
      <Select multiple value={value} input={<OutlinedInput label={label} />}
        onChange={(e) => onChange(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
        renderValue={(sel) => sel.map(labelOf).join(', ')}>
        {opts.map((o) => (
          <MenuItem key={o.value} value={String(o.value)} dense>
            <Checkbox size="small" checked={value.includes(String(o.value))} sx={{ p: 0.5, mr: 1 }} />
            <ListItemText primary={o.label} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}

// Search box that updates the URL after the user pauses typing.
export function SearchField({ value, onChange, placeholder = 'Search', width = 260 }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  useEffect(() => {
    if (text === value) return undefined
    const t = setTimeout(() => onChange(text), 350)
    return () => clearTimeout(t)
  }, [text, value, onChange])
  return (
    <TextField size="small" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} sx={{ width }}
      slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
  )
}

export function DateField({ label, value, onChange }) {
  return (
    <TextField size="small" type="date" label={label} value={value} onChange={(e) => onChange(e.target.value)}
      slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 160 }} />
  )
}

export function FilterBar({ children, onClear, hasFilters }) {
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 1.5, alignItems: 'center' }}>
      {children}
      {hasFilters && <Button size="small" startIcon={<ClearIcon />} onClick={onClear}>Clear filters</Button>}
    </Stack>
  )
}
