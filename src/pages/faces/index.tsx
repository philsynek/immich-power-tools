import type { GetServerSideProps } from "next";

/** /faces → /faces/unnamed (room for more face tools under /faces/…). */
export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: "/faces/unnamed", permanent: false },
});

export default function FacesIndex() {
  return null;
}
