#include <iostream>
int main() {
  int limit;
  std::cin >> limit;
  int composite[31] = {};
  int marks[31] = {};
  int primes[31];
  int count = 0;
  composite[0] = 1;
  composite[1] = 1;
  for (int i = 2; i <= limit; i = i + 1) {
    if (composite[i] == 0) {
      primes[count] = i;
      count = count + 1;
    }
    for (int j = 0; j < count; j = j + 1) {
      int multiple = i * primes[j];
      if (multiple > limit) { break; }
      composite[multiple] = 1;
      marks[multiple] = marks[multiple] + 1;
      if (i % primes[j] == 0) { break; }
    }
  }
  for (int i = 0; i < count; i = i + 1) {
    if (i > 0) { std::cout << " "; }
    std::cout << primes[i];
  }
  std::cout << "\n";
  return 0;
}
