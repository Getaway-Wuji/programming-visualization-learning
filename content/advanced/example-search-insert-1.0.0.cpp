#include <iostream>

int main() {
  int n = {{n}};
  int values[12];
  for (int i = 0; i < n; i = i + 1) {
    std::cin >> values[i];
  }
  int target;
  std::cin >> target;
  int left = 0;
  int right = n;
  while (left < right) {
    int mid = left + (right - left) / 2;
    if (values[mid] < target) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  std::cout << left << "\n";
  return 0;
}
