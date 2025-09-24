import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type props = {
  countdown?: number;
};

export default function CountdownPhase({ countdown = 5 }: props) {
  const [timeLeft, setTimeLeft] = useState(countdown);
  const router = useRouter();

  useEffect(() => {
    if (timeLeft <= 0) {
      router.push("/test");
      return;
    }

    const timer = setTimeout(() => {
      setTimeLeft(timeLeft - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [timeLeft, router]);

  return (
    <>
      <div className="flex flex-col items-center mt-20 min-h-screen">
        <h1 className="text-4xl font-bold mb-4 text-accent-secondary">Starting in</h1>
        <h1 className="text-6xl font-bold text-accent-secondary">{timeLeft}</h1>
      </div>
    </>
  );
}
