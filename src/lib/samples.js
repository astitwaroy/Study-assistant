export const SAMPLES = [
  {
    label: 'Photosynthesis notes',
    text: `Photosynthesis is the process plants, algae and some bacteria use to turn light energy into chemical energy stored in glucose. It takes place in chloroplasts, mostly in the mesophyll cells of the leaf. The overall equation is 6CO2 + 6H2O + light energy → C6H12O6 + 6O2.

There are two stages. The light-dependent reactions happen in the thylakoid membranes. Chlorophyll absorbs mainly red and blue light and reflects green, which is why leaves look green. Water is split (photolysis), releasing oxygen as a by-product, and the captured energy is stored as ATP and NADPH.

The Calvin cycle (the light-independent reactions) happens in the stroma. The enzyme RuBisCO fixes carbon dioxide onto RuBP. ATP and NADPH from the light reactions are used to reduce the fixed carbon into G3P, a three-carbon sugar the plant uses to build glucose and other molecules.

The rate of photosynthesis is limited by light intensity, carbon dioxide concentration and temperature. Stomata on the underside of leaves let CO2 in and O2 and water vapour out; guard cells open and close them.`,
  },
  {
    label: 'TCP handshake notes',
    text: `TCP is a connection-oriented transport protocol that guarantees ordered, reliable delivery of a byte stream. Before any data is sent, the client and server perform a three-way handshake to agree on initial sequence numbers.

First the client sends a SYN segment containing its initial sequence number. The server replies with a SYN-ACK segment that acknowledges the client's sequence number and carries its own. Finally the client sends an ACK, and the connection is established.

Sequence numbers let the receiver reorder segments and detect missing data. Acknowledgements tell the sender which bytes arrived, and unacknowledged segments are retransmitted after a timeout.

Closing a connection normally uses a four-step exchange of FIN and ACK segments, because each direction of the stream is closed independently. The side that closes first waits in the TIME_WAIT state so that delayed segments from the old connection expire.`,
  },
  {
    label: 'A topic: the French Revolution',
    text: 'The French Revolution (1789–1799)',
  },
];
