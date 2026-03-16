//! MPEG-TS PCR extraction.
//!
//! An MPEG-TS stream is a sequence of 188-byte packets, each starting with a
//! sync byte (0x47).  Certain packets carry a PCR (Program Clock Reference) in
//! their adaptation field.  When the encoder sets `base_time = 0`, the PCR
//! is derived from the wall-clock capture time; the ingest sync coordinator
//! uses it to compute per-stream delays and align all feeds.
//!
//! PCR clock rate: 27 MHz.  Max value: 2^33 * 300 + 511 ≈ 2.576 × 10^12
//! (wraps every ~26.5 hours).

pub const TS_PACKET_SIZE: usize = 188;
pub const SYNC_BYTE: u8 = 0x47;

/// Convert a raw 27 MHz PCR value to nanoseconds.
#[inline]
pub fn pcr_to_ns(pcr: u64) -> u64 {
    // pcr_ns = pcr * 1_000_000_000 / 27_000_000
    // Use u128 to avoid overflow.
    (pcr as u128 * 1_000_000_000 / 27_000_000) as u64
}

/// Extract the PCR value from a single 188-byte MPEG-TS packet, if present.
///
/// Returns the raw 27 MHz PCR value, or `None` if this packet carries no PCR.
pub fn extract_pcr(packet: &[u8]) -> Option<u64> {
    if packet.len() < TS_PACKET_SIZE || packet[0] != SYNC_BYTE {
        return None;
    }

    // Byte 3 bits [5:4]: adaptation_field_control
    //   0b01 = payload only
    //   0b10 = adaptation field only
    //   0b11 = adaptation field + payload
    let afc = (packet[3] >> 4) & 0x03;
    if afc != 0b10 && afc != 0b11 {
        return None; // no adaptation field
    }

    let af_len = packet[4] as usize;
    // Need at least 7 bytes of adaptation field for a PCR
    // (1 byte flags + 6 bytes PCR).
    if af_len < 7 || packet.len() < 5 + af_len {
        return None;
    }

    let flags = packet[5];
    if flags & 0x10 == 0 {
        return None; // PCR_flag not set
    }

    // PCR is encoded in bytes [6..12) of the packet:
    //   bits 47:15 → PCR base (33 bits)
    //   bit  14:9  → reserved (6 bits, all 1)
    //   bits  8:0  → PCR extension (9 bits)
    let b = &packet[6..12];
    let pcr_base: u64 = ((b[0] as u64) << 25)
        | ((b[1] as u64) << 17)
        | ((b[2] as u64) << 9)
        | ((b[3] as u64) << 1)
        | ((b[4] as u64) >> 7);
    let pcr_ext: u64 = (((b[4] as u64) & 0x01) << 8) | (b[5] as u64);

    Some(pcr_base * 300 + pcr_ext)
}

/// The 27 MHz PCR wraps every ≈95443 seconds (≈26.5 hours) expressed in ns.
pub const PCR_WRAP_NS: u64 = {
    // (2^33 * 300 + 511) * 1_000_000_000 / 27_000_000  ≈  9.544 × 10^13 ns
    let max_pcr: u64 = ((1u64 << 33) * 300) + 511;
    (max_pcr as u128 * 1_000_000_000 / 27_000_000) as u64
};

/// Given a raw PCR value (converted to ns) and the current wall-clock time
/// (ns since epoch), reconstruct the absolute epoch timestamp that the PCR
/// most likely represents.
///
/// The PCR wraps approximately every 26.5 hours; we pick the wrap-count `k`
/// such that the reconstructed time is closest to `wall_ns`.  For this to be
/// correct the caller must not be more than ~13 hours behind the stream.
pub fn unwrap_pcr_ns(pcr_ns: u64, wall_ns: u64) -> u64 {
    // How many full wraps fit below wall_ns?
    let k = wall_ns / PCR_WRAP_NS;
    // Candidate timestamps: k-1, k, k+1 full wraps
    let candidates = [
        k.saturating_sub(1) * PCR_WRAP_NS + pcr_ns % PCR_WRAP_NS,
        k * PCR_WRAP_NS + pcr_ns % PCR_WRAP_NS,
        (k + 1) * PCR_WRAP_NS + pcr_ns % PCR_WRAP_NS,
    ];
    // Return the candidate closest to wall_ns
    candidates
        .iter()
        .copied()
        .min_by_key(|&c| if c > wall_ns { c - wall_ns } else { wall_ns - c })
        .unwrap()
}

/// Scan an MPEG-TS buffer (multiple 188-byte packets) and return the first
/// PCR found, along with the byte offset at which it was found.
pub fn scan_for_pcr(buf: &[u8]) -> Option<(u64, usize)> {
    let mut offset = 0;
    while offset + TS_PACKET_SIZE <= buf.len() {
        if buf[offset] == SYNC_BYTE {
            if let Some(pcr) = extract_pcr(&buf[offset..offset + TS_PACKET_SIZE]) {
                return Some((pcr, offset));
            }
            offset += TS_PACKET_SIZE;
        } else {
            // Re-sync: scan byte by byte for the next sync byte.
            offset += 1;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_pcr_packet(pcr_base: u64, pcr_ext: u64) -> [u8; TS_PACKET_SIZE] {
        let mut p = [0u8; TS_PACKET_SIZE];
        p[0] = SYNC_BYTE;
        // PID = 0x0100, adaptation_field_control = 0b11 (adaptation + payload)
        p[1] = 0x41;
        p[2] = 0x00;
        p[3] = 0x30; // afc=0b11, cc=0
        p[4] = 7;    // adaptation_field_length
        p[5] = 0x10; // PCR_flag set
        // Encode PCR
        let b0 = (pcr_base >> 25) as u8;
        let b1 = (pcr_base >> 17) as u8;
        let b2 = (pcr_base >> 9) as u8;
        let b3 = (pcr_base >> 1) as u8;
        let b4 = (((pcr_base & 1) << 7) | 0b0111_1110 | ((pcr_ext >> 8) & 1)) as u8;
        let b5 = (pcr_ext & 0xFF) as u8;
        p[6] = b0; p[7] = b1; p[8] = b2; p[9] = b3; p[10] = b4; p[11] = b5;
        p
    }

    #[test]
    fn roundtrip_pcr() {
        let base: u64 = 12345678;
        let ext: u64 = 123;
        let pcr_val = base * 300 + ext;
        let pkt = make_pcr_packet(base, ext);
        assert_eq!(extract_pcr(&pkt), Some(pcr_val));
    }

    #[test]
    fn no_pcr_payload_only() {
        let mut p = [0u8; TS_PACKET_SIZE];
        p[0] = SYNC_BYTE;
        p[3] = 0x10; // afc=0b01 (payload only)
        assert_eq!(extract_pcr(&p), None);
    }

    #[test]
    fn unwrap_near_wrap() {
        // Simulate a PCR near wrap boundary: PCR_WRAP_NS - 1 second
        let epoch_ns: u64 = 1_710_000_000_000_000_000; // some epoch time
        let pcr_ns = epoch_ns % PCR_WRAP_NS;
        let recovered = unwrap_pcr_ns(pcr_ns, epoch_ns);
        assert!((recovered as i64 - epoch_ns as i64).abs() < 1_000_000_000);
    }
}
